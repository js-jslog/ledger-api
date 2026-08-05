import type { Request, RequestHandler } from 'express'
import type { Result } from 'neverthrow'

import type { DomainError } from '../domain/errors.js'
import { renderError } from './render-error.js'
import { responseValidatorFor } from './validator-for.js'

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
export const publicHandler = <S extends object, T>(
  responseSchema: S,
  fn: (req: Request) => PromiseLike<Result<Success<T>, DomainError>>,
): RequestHandler => {
  // Compiled once, when the route is registered, rather than once per request.
  //
  // Annotated as returning `Result<unknown, …>` rather than the schema's inferred type,
  // and the annotation is load-bearing: inferring it here instantiates `FromSchema` over
  // a still-generic `S` and TypeScript gives up with TS2589. Nothing is lost, because
  // the adapter's question is whether the body conformed and not what shape conforming
  // implies. R35.
  const validateResponse: (body: unknown) => Result<unknown, DomainError> =
    responseValidatorFor(responseSchema)

  return async (req, res) => {
    const outcomeRz = await fn(req)

    outcomeRz
      // The validator returns the body it checked — the serialised form — so what is
      // sent is what satisfied the schema rather than something equal to it.
      .andThen((success) =>
        validateResponse(success.body).map((body) => ({ status: success.status, body })),
      )
      .match(
        (success) => {
          res.status(success.status).json(success.body)
        },
        (error) => {
          renderError(res, error)
        },
      )
  }
}
