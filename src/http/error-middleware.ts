import type { ErrorRequestHandler, RequestHandler } from 'express'
import { notFound, unexpected, validationFailed, type DomainError } from '../domain/errors.js'
import { renderError } from './render-error.js'

/** body-parser's marker for a body it could not parse. */
function isMalformedJson(err: unknown): boolean {
  // body-parser bolts `type` onto a stock SyntaxError, so the property is not on
  // the SyntaxError type. Narrowing has to go through `unknown`; casting
  // SyntaxError straight to `{ type: string }` is rejected as non-overlapping.
  if (!(err instanceof SyntaxError)) return false
  const { type } = err as unknown as { type?: unknown }
  return type === 'entity.parse.failed'
}

/**
 * The translation boundary of §8. Infrastructure failures never touch a
 * `Result`; they arrive here and are converted into the same DomainError union
 * the service layer produces, then handed to the one renderer.
 *
 * MUST be registered last, and MUST keep four parameters. Express decides an
 * error handler is an error handler purely by `fn.length === 4`; write three
 * and it silently becomes ordinary middleware, errors go to Express's default
 * handler, and the stack-trace leak in §8 comes back. The `ErrorRequestHandler`
 * annotation is what stops that being a live risk — probe 02 demonstrates the
 * failure so the annotation is understood as load-bearing, not decorative.
 */
export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  // A response already committed cannot be re-rendered; Express's own default
  // would destroy the socket. Nothing useful is left to say.
  if (res.headersSent) {
    res.end()
    return
  }

  const translated: DomainError = isMalformedJson(err)
    ? // Without this branch body-parser's SyntaxError renders as a bare 400 with
      // an empty object, which does not satisfy BadRequestErrorResponse.
      validationFailed([
        { field: 'body', message: 'Request body is not valid JSON', type: 'entity.parse.failed' },
      ])
    : unexpected(err)

  renderError(res, translated)
}

/**
 * The 404 fallback. §8: `app.use('*')` and `app.all('*')` both throw at startup
 * under path-to-regexp v8, so the fallback takes no path argument and relies on
 * being registered after every route.
 */
export const notFoundMiddleware: RequestHandler = (_req, res) => {
  // Goes through the constructor and the one renderer rather than hand-rolling an
  // envelope. Hand-rolling was fine before; now it would be the single response in
  // the service without a correlation id, and the single failure with no log record.
  renderError(res, notFound('Resource'))
}
