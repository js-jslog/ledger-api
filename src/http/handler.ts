import type { Request, RequestHandler } from 'express'
import { err, ok, type Result } from 'neverthrow'

import { unauthenticated, type DomainError } from '../domain/errors.js'
import { verify_tokenRzA } from '../domain/tokens.js'
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
 * `authedHandler` below wraps this rather than replacing it, so everything stated here
 * holds for an authenticated route too.
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

/**
 * `Bearer ` exactly, and the token is whatever follows. A missing header, a `Basic` one and
 * a `Bearer` with nothing after it are all the same 401 as a token that fails to verify —
 * see `unauthenticated` in `src/domain/errors.ts` for why none of them may say more.
 */
const BEARER = /^Bearer (.+)$/

const bearerTokenRz = (req: Request): Result<string, DomainError> => {
  const token = BEARER.exec(req.get('authorization') ?? '')?.[1]

  return token === undefined ? err(unauthenticated({ reason: 'NoBearerToken' })) : ok(token)
}

/**
 * Every route except signup and login.
 *
 * IT WRAPS `publicHandler` RATHER THAN REPLACING IT, and that is the decision worth
 * knowing. Two sibling adapters would mean the egress check lives in one of them, and
 * registering a route with the wrong one would silently opt out of the mechanism behind
 * "no persistence entity and no password hash ever reaches a response body". Here there is
 * no second path to `res` at all: this function's only way to answer a request is through
 * the one above.
 *
 * AUTHENTICATION RUNS INSIDE THE ADAPTER, which is what makes the handler signature
 * `(userId, req)` rather than `(req)`. A handler cannot run before a token has verified,
 * because the adapter has not called it yet; and it cannot ask "who is this" and get no
 * answer, because `userId` is a `string` parameter rather than something optional it might
 * forget to check. Writing a route that is authenticated in name only is not discouraged
 * here, it is unrepresentable — tried, and pinned in `handler.type-assertions.ts`.
 *
 * The `userId` a handler receives is the `sub` claim of a verified token and never a path
 * parameter, which is the half of section 3's ownership invariant this file owns. Comparing
 * it against the resource is the service layer's, and arrives with the first route that
 * resolves one.
 */
export const authedHandler = <S extends object, T>(
  responseSchema: S,
  fn: (userId: string, req: Request) => PromiseLike<Result<Success<T>, DomainError>>,
): RequestHandler =>
  publicHandler(responseSchema, async (req) => {
    const userIdRz = await bearerTokenRz(req).asyncAndThen(verify_tokenRzA)

    // Short-circuits: `fn` is not called at all on a failed authentication, so a handler
    // has no unauthenticated path to be careful on.
    return userIdRz.isErr() ? err(userIdRz.error) : fn(userIdRz.value, req)
  })
