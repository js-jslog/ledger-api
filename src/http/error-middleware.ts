import type { ErrorRequestHandler, RequestHandler } from 'express'

import { notFound, unexpected, validationFailed, type DomainError } from '../domain/errors.js'
import { renderError } from './render-error.js'

/**
 * The two terminal middlewares, registered after every route in that order. They are a
 * pair: the first turns "no route matched" into an envelope, and without the second an
 * unhandled throw renders as Express's own HTML page carrying a stack trace with
 * absolute filesystem paths.
 */

export const notFoundFallback: RequestHandler = (req, res) => {
  // The requested path is not echoed into the response. It is client-controlled, and
  // reflecting it buys the caller nothing they did not already send. It goes to the log,
  // where `JSON.stringify` escapes it.
  renderError(res, notFound('Resource not found', { method: req.method, path: req.path }))
}

const isParseFailure = (error: unknown): boolean =>
  error instanceof SyntaxError && hasType(error, 'entity.parse.failed')

const isTooLarge = (error: unknown): boolean => hasType(error, 'entity.too.large')

const hasType = (error: unknown, type: string): boolean =>
  typeof error === 'object' && error !== null && 'type' in error && error.type === type

/**
 * The translation boundary. Infrastructure failures arrive here having never touched a
 * `Result`, and leave as the same domain error type everything else renders through.
 *
 * body-parser's own message is deliberately discarded. It embeds a fragment of the
 * offending body — `Unexpected token } in JSON at position 5` is the harmless case, and
 * a failed signup carrying a password is not. Nothing here reads it. Measured, in
 * `error-envelope.test.ts`.
 */
const translate = (error: unknown): DomainError => {
  if (isParseFailure(error)) {
    return validationFailed('Request body is not valid JSON', [
      { field: 'body', message: 'must be valid JSON', type: 'entity.parse.failed' },
    ])
  }

  if (isTooLarge(error)) {
    return validationFailed('Request body is too large', [
      { field: 'body', message: 'must be within the request size limit', type: 'entity.too.large' },
    ])
  }

  return unexpected(error)
}

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  // A handler that writes a response and then throws arrives here with the response
  // already committed, and the renderer's first act is `res.status(...)`, which throws
  // from the one place in the stack with nothing above it to catch.
  if (res.headersSent) {
    res.end()
    return
  }

  renderError(res, translate(error))
}
