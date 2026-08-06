/**
 * A test enforced by `pnpm typecheck`, not by the test runner. It has no runtime
 * assertions because there is nothing to run: everything it checks has already been
 * decided by the time the program exists.
 *
 * WHAT IT STANDS AGAINST. `validatorFor` infers the validated body type from the
 * schema it is handed, which needs the schema to be `as const`. Without it the literal
 * types widen, `FromSchema` has nothing to work from, and the validated body becomes
 * `unknown` — silently. There is no error. Runtime validation goes on working
 * perfectly; only the compile-time half quietly stops existing, which is the worse
 * half to lose, because it is the half nothing else covers.
 *
 * So this file is the only thing standing where the compiler will not.
 */
import type { Result } from 'neverthrow'

import {
  accountResponseSchema,
  tokenResponseSchema,
  transactionResponseSchema,
  userResponseSchema,
} from './response-schemas.js'
import {
  accountParamsSchema,
  createAccountSchema,
  createTransactionSchema,
  createUserSchema,
  loginSchema,
  tokenClaimsSchema,
  transactionParamsSchema,
  userParamsSchema,
} from './schemas.js'
import { responseValidatorFor, validatorFor } from './validator-for.js'

/** True only for `unknown`. `any` is excluded, or it would satisfy every assertion. */
type IsAny<T> = 0 extends 1 & T ? true : false
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false

/** Accepts only `false`, so passing `IsUnknown<T>` fails to compile when T is unknown. */
const assertNotUnknown = <_Degraded extends false>(): void => {}

type ValidatedBody<F> = F extends (body: unknown) => Result<infer T, unknown> ? T : never

// ── The assertion ────────────────────────────────────────────────────────────────
// Every schema the service validates against belongs here. A schema that is added to
// the codebase and not added below is not covered.

const _properSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email'],
  properties: { email: { type: 'string' } },
} as const satisfies Record<string, unknown>

assertNotUnknown<IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof _properSchema>>>>>()

// The schemas the service actually validates against, ingress and egress. The egress
// half is covered for the same reason as the ingress half: `responseValidatorFor` infers
// from its argument identically, so a response schema that lost its `as const` would
// degrade in the same silence.

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof createUserSchema>>>>
>()

assertNotUnknown<IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof loginSchema>>>>>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof tokenClaimsSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof userParamsSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof accountParamsSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof createAccountSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof createTransactionSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof transactionParamsSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof responseValidatorFor<typeof userResponseSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof responseValidatorFor<typeof tokenResponseSchema>>>>
>()

assertNotUnknown<
  IsUnknown<ValidatedBody<ReturnType<typeof responseValidatorFor<typeof accountResponseSchema>>>>
>()

assertNotUnknown<
  IsUnknown<
    ValidatedBody<ReturnType<typeof responseValidatorFor<typeof transactionResponseSchema>>>
  >
>()

// ── The proof that the assertion can fail ────────────────────────────────────────
// Without this, the check above could be vacuously true and nobody would know. The
// only difference here is the missing `as const`.

const _widenedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email'],
  properties: { email: { type: 'string' } },
}

// @ts-expect-error -- degrades to `unknown`, exactly as a missing `as const` does.
assertNotUnknown<IsUnknown<ValidatedBody<ReturnType<typeof validatorFor<typeof _widenedSchema>>>>>()
