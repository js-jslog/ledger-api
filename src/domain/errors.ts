import { currentCorrelationId } from '../observability/correlation.js'
import { emit, type LogLevel } from '../observability/logger.js'

/**
 * The closed union of domain failures, now carrying a correlation id and logging
 * itself at the moment of construction.
 *
 * WHAT DELIBERATELY DID NOT CHANGE. This is still a closed union of plain data with
 * one constructor function per member, and `render-error.ts` is still a single
 * function the compiler proves total via its `never` default branch. An AppError
 * class hierarchy would trade that compile-time totality for a runtime one and gain
 * nothing. The seven constructors below were already the single chokepoint through
 * which every error in the service is born, which is exactly the seam
 * log-at-construction needs — so this is an addition to the existing design rather
 * than a replacement of it.
 *
 * WHAT IS DELIBERATELY NOT BUILT, so it does not get built twice:
 *   - No `code` field. `kind` already is the error code and the closed message set;
 *     it is what `render-error.ts` switches on to choose a status. A second field
 *     would be a synonym free to drift out of step with it.
 *   - No cause-chaining machinery. `Unexpected.cause` already does it. Only its
 *     logging site moved, out of the renderer and into `unexpected()`.
 *
 * THE HONEST COST OF LOG-AT-CONSTRUCTION. It logs when an error is *created*, which
 * is not quite the same as when one *occurs*. Code that builds an error and then
 * discards it produces a record for a non-event. Nothing in this service does that
 * today — every constructor call site returns its error immediately — but it is a
 * real constraint on future code, and it is the price of the guarantee that no
 * error can exist unlogged.
 */

/** One entry of the spec's `BadRequestErrorResponse.details` array. */
export type FieldError = {
  readonly field: string
  readonly message: string
  readonly type: string
}

/** The discriminated members. Never used directly — see `DomainError` below. */
type DomainErrorKind =
  /** 400 — ingress (or egress) schema rejected the payload. The only error with `details`. */
  | { readonly kind: 'ValidationFailed'; readonly details: readonly FieldError[] }
  /** 401 — no bearer token, or one that does not verify. */
  | { readonly kind: 'Unauthenticated'; readonly detail: string }
  /** 403 — authenticated, resource exists, but is owned by someone else. */
  | { readonly kind: 'Forbidden' }
  /** 404 — no such resource, or not visible in the scope queried. */
  | { readonly kind: 'NotFound'; readonly resource: string }
  /** 409 — email already registered. Created by spec change 1 (§6). */
  | { readonly kind: 'AlreadyExists'; readonly resource: string }
  /** 422 — the expected outcome that is not an exception (§4). */
  | { readonly kind: 'InsufficientFunds' }
  /**
   * 500 — translated from a throw. `cause` is logged, never rendered.
   *
   * `fellThrough` is the default-classification marker: this member *is* the
   * catch-all branch, so the flag needs no error-trace machinery to be useful. In a
   * log record it reads as "this was not classified, consider a specific branch",
   * which is the cheapest possible version of that signal.
   */
  | { readonly kind: 'Unexpected'; readonly cause: unknown; readonly fellThrough: true }

/**
 * The union intersected with the correlation id, in one place rather than as a
 * field repeated on each member. Adding a member cannot forget it.
 */
export type DomainError = DomainErrorKind & { readonly correlationId: string }

/**
 * Log level follows `kind`, and this is what stops log-at-construction becoming
 * noise. The 4xx members are expected outcomes of ordinary client mistakes — a
 * missing field, a wrong password, an overdrawn account — and an alert on those
 * is an alert on users behaving normally. `Unexpected` is the only member that is
 * genuinely an error.
 */
const LEVELS: Record<DomainErrorKind['kind'], LogLevel> = {
  ValidationFailed: 'info',
  Unauthenticated: 'warn',
  Forbidden: 'warn',
  NotFound: 'info',
  AlreadyExists: 'info',
  InsufficientFunds: 'info',
  Unexpected: 'error',
}

/**
 * Data that goes to the log and not to the client.
 *
 * Keeping it in a separate parameter — rather than as fields on `DomainError` — is
 * what keeps the renderer from being able to render it: the renderer only ever sees
 * a `DomainError`, so there is no `schemaPath` available to it even by accident.
 *
 * BUT THE RESPONSE BOUNDARY IS NOT A SUFFICIENT DEFENCE, and an earlier version of
 * this module claimed it was. "The response boundary is the protection, not
 * redaction" protects the *client*. It says nothing about who reads the logs, and a
 * log store is exactly where credentials go on to have a long, widely-replicated and
 * badly-governed life. Every large plaintext-password incident of the last decade was
 * this, not a database breach. So the request payload is not logged at all — see
 * `PayloadForbidden` below.
 */
export type LogOnly = {
  /** Ajv's schemaPath — more useful than instancePath for debugging, never rendered. */
  readonly schemaPaths?: readonly string[]
  /** Anything else worth stitching by correlation id. */
  readonly [field: string]: unknown
}

/**
 * `LogOnly` with `payload` made a **type error**, for every constructor that can be
 * reached with client-supplied input.
 *
 * The fix for logging credentials is a deletion, not a redaction mechanism — a
 * denylist on key names fails open, and the next credential-bearing field will not be
 * called `password`. But a deletion alone is only as durable as the next person's
 * memory, and `LogOnly`'s index signature would accept a re-added `payload` in
 * silence. `payload?: never` makes putting it back a compile error.
 *
 * The asymmetry is the point, and it is enforced by which constructor a call site
 * uses:
 *   - ingress failures go through `validationFailed` → payload forbidden;
 *   - egress failures go through `unexpected` → payload permitted, because that body
 *     is the service's own output rather than anything a client sent.
 */
export type PayloadForbidden = LogOnly & { readonly payload?: never }

/** The one place an error is born, logged and stamped with its correlation id. */
function build<E extends DomainErrorKind>(kind: E, logOnly: LogOnly = {}): E & { correlationId: string } {
  const correlationId = currentCorrelationId()
  emit({
    level: LEVELS[kind.kind],
    event: 'domain_error',
    correlationId,
    ...kind,
    ...logOnly,
  })
  return { ...kind, correlationId }
}

export const validationFailed = (
  details: readonly FieldError[],
  logOnly?: PayloadForbidden,
): DomainError => build({ kind: 'ValidationFailed', details }, logOnly)

export const unauthenticated = (detail: string, logOnly?: PayloadForbidden): DomainError =>
  build({ kind: 'Unauthenticated', detail }, logOnly)

export const forbidden = (logOnly?: PayloadForbidden): DomainError => build({ kind: 'Forbidden' }, logOnly)

export const notFound = (resource: string, logOnly?: PayloadForbidden): DomainError =>
  build({ kind: 'NotFound', resource }, logOnly)

export const alreadyExists = (resource: string, logOnly?: PayloadForbidden): DomainError =>
  build({ kind: 'AlreadyExists', resource }, logOnly)

export const insufficientFunds = (logOnly?: PayloadForbidden): DomainError =>
  build({ kind: 'InsufficientFunds' }, logOnly)

export const unexpected = (cause: unknown, logOnly?: LogOnly): DomainError =>
  build({ kind: 'Unexpected', cause, fellThrough: true }, {
    ...logOnly,
    // The stack is the whole value of an unexpected error and it is the one thing
    // §8 insists must not be rendered. It belongs here, in the log-only channel.
    stack: cause instanceof Error ? cause.stack : undefined,
  })
