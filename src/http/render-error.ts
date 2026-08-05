import type { Response } from 'express'

import { levelFor, type DomainError, type FieldError } from '../domain/errors.js'
import { log } from '../observability/logger.js'

/**
 * Kind to status, in one table. Adding a member to `DomainError` fails to compile here,
 * because `Record` over the union's `kind` requires every key — so extending the union
 * asks for the status rather than defaulting to one.
 *
 * This replaces the `switch` with a `never` default that the design called for, and the
 * two were measured against each other rather than argued about: a `never` default fails
 * as "type X is not assignable to never", which does not name the kind that is missing,
 * where this fails as "property X is missing". See docs/divergences.md § Slice 1.
 *
 * The log level is deliberately NOT here. It belongs to the same kind but it is decided
 * beside the constructors, so that an error is born and rendered at one level rather than
 * two that happen to agree.
 */
const STATUSES: Record<DomainError['kind'], number> = {
  ValidationFailed: 400,
  NotFound: 404,
  Unexpected: 500,
}

/**
 * `correlationId` is an addition to what the specification publishes, and a permitted
 * one: neither `ErrorResponse` nor `BadRequestErrorResponse` sets
 * `additionalProperties: false`. Recorded in docs/spec-changes.md § Additions.
 */
type Envelope = {
  readonly message: string
  readonly correlationId: string
  readonly details?: readonly FieldError[]
}

const envelopeFor = (error: DomainError): Envelope =>
  error.kind === 'ValidationFailed'
    ? { message: error.message, details: error.details, correlationId: error.correlationId }
    : { message: error.message, correlationId: error.correlationId }

/**
 * The one renderer. Two sources reach it — a `Result` from a handler, and Express's
 * error middleware translating an infrastructure failure — and nothing else in the
 * codebase writes an error envelope, which is what keeps the union closed.
 *
 * It logs the outcome only. The detail was logged when the error was born.
 */
export const renderError = (res: Response, error: DomainError): void => {
  const status = STATUSES[error.kind]

  log(levelFor(error), 'request.failed', { kind: error.kind, status })

  res.status(status).json(envelopeFor(error))
}
