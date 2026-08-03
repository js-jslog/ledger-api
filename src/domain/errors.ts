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
 * Data that goes to the log and must never reach the client.
 *
 * Keeping it in a separate parameter — rather than as fields on `DomainError` — is
 * what enforces that. The renderer only ever sees a `DomainError`, so there is no
 * payload and no `schemaPath` available to it even by accident. The response
 * boundary is the protection, not obfuscation of the record.
 */
export type LogOnly = {
  /** The offending request or response body, in full. */
  readonly payload?: unknown
  /** Ajv's schemaPath — more useful than instancePath for debugging, never rendered. */
  readonly schemaPaths?: readonly string[]
  /** Anything else worth stitching by correlation id. */
  readonly [field: string]: unknown
}

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
  logOnly?: LogOnly,
): DomainError => build({ kind: 'ValidationFailed', details }, logOnly)

export const unauthenticated = (detail: string, logOnly?: LogOnly): DomainError =>
  build({ kind: 'Unauthenticated', detail }, logOnly)

export const forbidden = (logOnly?: LogOnly): DomainError => build({ kind: 'Forbidden' }, logOnly)

export const notFound = (resource: string, logOnly?: LogOnly): DomainError =>
  build({ kind: 'NotFound', resource }, logOnly)

export const alreadyExists = (resource: string, logOnly?: LogOnly): DomainError =>
  build({ kind: 'AlreadyExists', resource }, logOnly)

export const insufficientFunds = (logOnly?: LogOnly): DomainError =>
  build({ kind: 'InsufficientFunds' }, logOnly)

export const unexpected = (cause: unknown, logOnly?: LogOnly): DomainError =>
  build({ kind: 'Unexpected', cause, fellThrough: true }, {
    ...logOnly,
    // The stack is the whole value of an unexpected error and it is the one thing
    // §8 insists must not be rendered. It belongs here, in the log-only channel.
    stack: cause instanceof Error ? cause.stack : undefined,
  })
