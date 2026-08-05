/**
 * A test enforced by `pnpm typecheck`, not by the test runner, for the same reason as
 * `validator-for.type-assertions.ts`: everything it checks is decided before the program
 * exists, so there is nothing to run.
 *
 * WHAT IT STANDS AGAINST. Section 3 lists "every `Result` is handled" as mechanised
 * rather than reviewed, and the adapter is the mechanism. That claim is only worth
 * anything if the failures below really are failures — a rule that reports nothing is
 * indistinguishable from a rule that is switched off. Each `@ts-expect-error` fails the
 * build if the error it names stops being produced.
 */
import type { Request } from 'express'
import { errAsync, ok, okAsync, type Result, type ResultAsync } from 'neverthrow'

import type { DomainError } from '../domain/errors.js'
import { publicHandler, type Success } from './handler.js'

type Body = { readonly id: string }

const success: Success<Body> = { status: 200, body: { id: 'x' } }

/**
 * The adapter's response-schema parameter. It is deliberately NOT coupled to `T`: the
 * schema's inferred type cannot be threaded through the handler's type parameter
 * without instantiating `FromSchema` over a generic, which is TS2589. R35 records what
 * that costs.
 */
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const

// ── The two handler shapes that are meant to work ────────────────────────────────
// Both channels present, and the error channel is the closed domain union. Both
// spellings are pinned because the parameter is `PromiseLike` rather than `Promise`
// precisely so that a service returning a `ResultAsync` needs no wrapper — and a
// `ResultAsync` is NOT a `Promise`, so narrowing that parameter would break the second
// case while leaving the first passing.

publicHandler(
  schema,
  async (_req: Request): Promise<Result<Success<Body>, DomainError>> =>
    Promise.resolve(ok(success)),
)

publicHandler(schema, (_req: Request): ResultAsync<Success<Body>, DomainError> =>
  okAsync(success),
)

// ── Forgetting the error channel entirely ────────────────────────────────────────
// The shape a handler falls into when it just returns the thing it computed. There is
// no overload that accepts it, so "I forgot errors exist" is not a bug review has to
// catch.

// @ts-expect-error -- a bare body is not a Result, so the error channel cannot be ignored.
publicHandler(schema, (_req: Request): Promise<Success<Body>> => Promise.resolve(success))

// ── Widening the error channel past the closed union ─────────────────────────────
// The union stays closed at the boundary: an error the renderer has no branch for cannot
// reach it, because it cannot be returned in the first place.

publicHandler(
  schema,
  // @ts-expect-error -- `string` is not a DomainError, so nothing can smuggle a bare message in.
  (_req: Request): Promise<Result<Success<Body>, string>> => errAsync('something went wrong'),
)

// ── Dropping the status ──────────────────────────────────────────────────────────
// `res.json(undefined)` answers 200 with an empty body, which is what a dropped value
// looks like from outside. `Success<T>` carrying the status is what makes that a type
// error rather than a silent success.

publicHandler(
  schema,
  // @ts-expect-error -- a body with no status is not a Success.
  (_req: Request): Promise<Result<Body, DomainError>> => okAsync({ id: 'x' }),
)

// ── A status the specification does not publish for a success ────────────────────

publicHandler(
  schema,
  (_req: Request): Promise<Result<Success<Body>, DomainError>> =>
    // @ts-expect-error -- 204 is not one of the two success statuses this API returns.
    okAsync({ status: 204, body: { id: 'x' } }),
)
