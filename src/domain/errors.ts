import { currentCorrelationId } from '../observability/correlation.js'
import { log, type Level, type LogFields } from '../observability/logger.js'

/** One entry in the `details` array the specification requires on a 400. */
export type FieldError = {
  readonly field: string
  readonly message: string
  readonly type: string
}

type ValidationFailed = {
  readonly kind: 'ValidationFailed'
  readonly message: string
  readonly details: readonly FieldError[]
}

type NotFound = {
  readonly kind: 'NotFound'
  readonly message: string
}

type AlreadyExists = {
  readonly kind: 'AlreadyExists'
  readonly message: string
}

type Unauthenticated = {
  readonly kind: 'Unauthenticated'
  readonly message: string
}

type Forbidden = {
  readonly kind: 'Forbidden'
  readonly message: string
}

type Unexpected = {
  readonly kind: 'Unexpected'
  readonly message: string
}

export type DomainError = { readonly correlationId: string } & (
  | ValidationFailed
  | NotFound
  | AlreadyExists
  | Unauthenticated
  | Forbidden
  | Unexpected
)

/**
 * A regression guard against one specific defect, and it is worth being exact about
 * that, because the name reads broader than the guarantee.
 *
 * THE DEFECT. An earlier design logged the whole offending request body under a
 * `payload` key, and its own test asserted it — so a failed signup wrote real
 * credentials to the log store. The obvious fix is to delete the line, but `LogFields`
 * is an open index signature and would accept it back in silence. `payload?: never`
 * makes putting it back a compile error.
 *
 * WHAT IT DOES NOT DO. It guards one key name. `{ body }`, `{ requestBody }` and
 * `{ ...body }` all compile, and the last is the worst of them, because spreading puts
 * every field of the body in under its own name. Measured, and pinned in
 * `errors.type-assertions.ts` so the limit is recorded rather than assumed.
 *
 * WHAT ACTUALLY KEEPS BODIES OUT OF THE LOG TODAY is not this type. It is that the
 * constructors compose their own log fields from Ajv's error metadata — field names,
 * never values — and no call site passes a body under any key. The general mechanism is
 * an allowlist of loggable fields rather than a ban on one; R24 prices it.
 *
 * The asymmetry is deliberate and is carried by which constructor a call site reaches
 * for: ingress failures go through `validationFailed`, where the offending value is a
 * credential often enough that it must never be logged, while `unexpected` permits a
 * payload because its detail is normally about the service rather than about the
 * request.
 *
 * THE STATED REASON FOR THAT EXEMPTION WAS WRONG, and the first call site to test it
 * proved so. It read: the body `unexpected` will carry is the service's own output, and
 * when a response fails its published schema that body is the entire diagnostic. The
 * response that fails its published schema is, in the case egress validation exists to
 * catch, one carrying a leaked `password_hash` — so logging the body writes the secret
 * to the log store instead of the wire, which is not a fix. `responseValidatorFor` logs
 * Ajv's mismatches, which name the offending property and never its value. The
 * permission stands; the justification does not. See docs/divergences.md § Slice 2.
 */
type PayloadForbidden = LogFields & { readonly payload?: never }

/**
 * The 4xx members are ordinary client mistakes. Without that distinction,
 * log-at-construction is an alert that fires on users behaving normally.
 */
const LEVELS: Record<DomainError['kind'], Level> = {
  ValidationFailed: 'info',
  NotFound: 'info',
  AlreadyExists: 'info',
  Unauthenticated: 'info',
  Forbidden: 'info',
  Unexpected: 'error',
}

export const levelFor = (error: DomainError): Level => LEVELS[error.kind]

const born = <E extends { readonly kind: DomainError['kind'] }>(
  error: E,
  fields: LogFields,
): E & { readonly correlationId: string } => {
  log(LEVELS[error.kind], 'error.created', { ...fields, kind: error.kind })

  return { ...error, correlationId: currentCorrelationId() }
}

export const validationFailed = (
  message: string,
  details: readonly FieldError[],
  fields: PayloadForbidden = {},
): DomainError =>
  born(
    { kind: 'ValidationFailed', message, details },
    { ...fields, invalidFields: details.map((detail) => detail.field) },
  )

export const notFound = (message: string, fields: PayloadForbidden = {}): DomainError =>
  born({ kind: 'NotFound', message }, fields)

export const alreadyExists = (message: string, fields: PayloadForbidden = {}): DomainError =>
  born({ kind: 'AlreadyExists', message }, fields)

/**
 * The only constructor that takes no message, and the omission is the mechanism.
 *
 * Every reason to answer 401 — no header, a malformed one, a signature that does not
 * verify, an expired token, an unknown email, a wrong password — must be indistinguishable
 * from outside, because a client that can tell them apart can ask which emails exist. A
 * `message` parameter is how that distinction gets reintroduced, one plausible call site at
 * a time. There is no parameter, so there is nothing to vary.
 *
 * The reason still reaches the log, through `fields`, where naming it costs nothing.
 */
export const unauthenticated = (fields: PayloadForbidden = {}): DomainError =>
  born({ kind: 'Unauthenticated', message: 'Authentication failed' }, fields)

export const forbidden = (message: string, fields: PayloadForbidden = {}): DomainError =>
  born({ kind: 'Forbidden', message }, fields)

const describeCause = (cause: unknown): LogFields =>
  cause instanceof Error
    ? { name: cause.name, message: cause.message, stack: cause.stack }
    : { name: 'NonError', message: String(cause) }

/**
 * The client-facing message is fixed and generic. Everything identifying the failure
 * goes to the log instead, because this is the only member whose detail is always about
 * the service rather than about the request.
 */
export const unexpected = (cause: unknown, fields: LogFields = {}): DomainError =>
  born({ kind: 'Unexpected', message: 'An unexpected error occurred' }, {
    ...fields,
    cause: describeCause(cause),
  })
