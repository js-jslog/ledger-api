import type { Response } from 'express'
import type { DomainError } from '../domain/errors.js'
import { CORRELATION_HEADER } from '../observability/correlation.js'
import { emit } from '../observability/logger.js'

/**
 * The one renderer. Every error envelope in the service is produced here.
 *
 * The `never` assignment in the default branch is what makes "the union stays
 * closed" a compile-time claim rather than a comment: adding a member to
 * DomainError without adding a case here fails `tsc`. Probe 02 verifies that, and
 * probe 10 re-verifies it survived the correlation-id intersection.
 *
 * THE DIVISION OF LOGGING LABOUR. The constructors log the *detail* — payload,
 * schemaPath, cause, stack — at the moment the error is born. This function logs
 * the *outcome*: status, route, correlation id. Nothing else. Without that split
 * every failure produces two records carrying the same information, and the
 * correlation id starts working against legibility instead of for it.
 */
export function renderError(res: Response, error: DomainError): void {
  const status = statusFor(error)

  // The header is set by correlationMiddleware for every request; setting it again
  // here covers errors raised before that middleware ran, and costs nothing.
  res.setHeader(CORRELATION_HEADER, error.correlationId)

  emit({
    level: status >= 500 ? 'error' : 'info',
    event: 'request_failed',
    correlationId: error.correlationId,
    kind: error.kind,
    status,
    method: res.req.method,
    route: res.req.originalUrl,
    // Deliberately no payload, no cause, no stack, no schemaPath. Those were
    // logged once, at construction.
  })

  res.status(status).json(bodyFor(error))
}

function statusFor(error: DomainError): number {
  switch (error.kind) {
    case 'ValidationFailed':
      return 400
    case 'Unauthenticated':
      return 401
    case 'Forbidden':
      return 403
    case 'NotFound':
      return 404
    case 'AlreadyExists':
      return 409
    case 'InsufficientFunds':
      return 422
    case 'Unexpected':
      return 500
    default: {
      const exhaustive: never = error
      throw new Error(`unrenderable error: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * The client-facing envelope. `correlationId` is included so a user can quote it
 * in a support request and it can be found in the logs — that is the entire reason
 * the id leaves the process.
 */
function bodyFor(error: DomainError): Record<string, unknown> {
  const base = { correlationId: error.correlationId }
  switch (error.kind) {
    case 'ValidationFailed':
      // BadRequestErrorResponse requires BOTH `message` and `details`, so `details`
      // is never omitted even when empty. Note what is NOT here: the offending
      // payload, and Ajv's schemaPath. Both are in the log record instead.
      return { ...base, message: 'Invalid request', details: error.details }
    case 'Unauthenticated':
      return { ...base, message: 'Access token is missing or invalid' }
    case 'Forbidden':
      return { ...base, message: 'Forbidden' }
    case 'NotFound':
      return { ...base, message: `${error.resource} was not found` }
    case 'AlreadyExists':
      return { ...base, message: `${error.resource} already exists` }
    case 'InsufficientFunds':
      return { ...base, message: 'Insufficient funds to process transaction' }
    case 'Unexpected':
      // §8: with no handler at all, Express 5 leaks a stack trace with absolute
      // filesystem paths. `cause` was logged by the constructor; it is never here.
      return { ...base, message: 'An unexpected error occurred' }
    default: {
      const exhaustive: never = error
      throw new Error(`unrenderable error: ${JSON.stringify(exhaustive)}`)
    }
  }
}
