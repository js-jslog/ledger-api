import type { Request, RequestHandler } from 'express'
import type { Result } from 'neverthrow'

import type { DomainError } from '../domain/errors.js'
import { renderError } from './render-error.js'

/**
 * Carrying the status alongside the body is what closes the silent-empty-success hole:
 * `res.json(undefined)` answers 200 with `content-length: 0`, which is exactly the shape
 * a handler falls into when it drops a `Result`'s value. Here there is no way to reach
 * `res.json` without having produced a `Success`, so the drop is a type error.
 */
export type Success<T> = { readonly status: 200 | 201; readonly body: T }

/**
 * The extension surface. A handler receives a request and returns a `Result`; it never
 * receives `res`, so it has no way to send a response, and the only thing it can do with
 * a `Result` is return it.
 *
 * `.match()` here is the single place in the codebase where a `Result` is consumed, and
 * it is exhaustive by construction — a handler that ignores its error channel is not a
 * bug to spot in review, it is a program that does not typecheck.
 *
 * The cost, which is real: handlers cannot stream, set custom headers, or send anything
 * but JSON. R13.
 *
 * `PromiseLike` rather than `Promise`, which is not a detail: neverthrow's `ResultAsync`
 * is thenable but is not a `Promise` — it has no `catch` or `finally` — so a `Promise`
 * parameter rejects the one shape a service layer naturally returns and forces every
 * handler into an `async` wrapper. Both spellings are pinned in
 * `handler.type-assertions.ts`.
 *
 * The authenticated variant is not here. It arrives with the authenticator, at the step
 * that builds JWT verification — see docs/divergences.md § Slice 1.
 */
export const publicHandler =
  <T>(fn: (req: Request) => PromiseLike<Result<Success<T>, DomainError>>): RequestHandler =>
  async (req, res) => {
    const outcomeRz = await fn(req)

    outcomeRz.match(
      (success) => {
        res.status(success.status).json(success.body)
      },
      (error) => {
        renderError(res, error)
      },
    )
  }
