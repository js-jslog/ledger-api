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

type Unexpected = {
  readonly kind: 'Unexpected'
  readonly message: string
}

export type DomainError = { readonly correlationId: string } & (
  | ValidationFailed
  | NotFound
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
 * payload because the body it will carry is the service's own output, and when a
 * response fails its published schema that body is the entire diagnostic.
 */
type PayloadForbidden = LogFields & { readonly payload?: never }

/**
 * The 4xx members are ordinary client mistakes. Without that distinction,
 * log-at-construction is an alert that fires on users behaving normally.
 */
const LEVELS: Record<DomainError['kind'], Level> = {
  ValidationFailed: 'info',
  NotFound: 'info',
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
