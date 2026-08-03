import type { Request, RequestHandler, Response } from 'express'
import type { Result } from 'neverthrow'
import type { DomainError } from '../domain/errors.js'
import { renderError } from './render-error.js'

/** What a handler returns on success: a status and a body, never a bare value. */
export type Success<T> = { readonly status: number; readonly body: T }

export const created = <T>(body: T): Success<T> => ({ status: 201, body })
export const okBody = <T>(body: T): Success<T> => ({ status: 200, body })
export const noContent = (): Success<null> => ({ status: 204, body: null })

/**
 * The adapter that turns a Result-returning function into an Express handler.
 *
 * This is the answer to §5's concession. §5 evaluates and rejects
 * `eslint-plugin-neverthrow`, and concludes: "The invariant moves to the human
 * checklist." That is a real loss, because §3's "**Every `Result` is handled**"
 * is the one invariant with no mechanical owner.
 *
 * It does not have to move to a checklist. The handler functions passed here
 * never receive `res`, so they have no way to send a response; the only thing they
 * can do with their Result is return it. `.match()` here is the single place a
 * Result is consumed, and it is exhaustive by construction. A handler that
 * forgets to handle its error channel is not a bug you have to notice — it is
 * a program you cannot write.
 *
 * That also closes §8's `res.json(undefined)` hazard ("a silent empty success,
 * and exactly the shape a handler falls into when a Result's value is accidentally
 * dropped"): the success channel is `Success<T>`, so a dropped value is a type
 * error rather than a 200 with no body.
 *
 * The cost, stated honestly: handlers cannot stream, set custom headers, or send
 * anything but JSON. For this API that is a fair trade; for one with file
 * downloads it would not be.
 */
export function handler<T>(
  fn: (req: Request) => Promise<Result<Success<T>, DomainError>>,
): RequestHandler {
  return (req, res, next) => {
    // The promise is deliberately handed to Express rather than awaited here:
    // Express 5 propagates a rejection to the error middleware, which is the
    // §8 "infrastructure failures" source. Probe 02 verified that path.
    fn(req)
      .then((result) => {
        result.match(
          (success) => {
            send(res, success)
          },
          (error) => {
            renderError(res, error)
          },
        )
      })
      .catch(next)
  }
}

function send<T>(res: Response, success: Success<T>): void {
  // 204 must not carry a body; res.json(null) would write "null".
  if (success.status === 204) {
    res.status(204).end()
    return
  }
  res.status(success.status).json(success.body)
}
