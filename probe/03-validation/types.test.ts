import { expect, expectTypeOf, test } from 'vitest'
import {
  createTransactionSchema,
  createUserSchema,
  jwtPayloadSchema,
  type CreateTransactionBody,
  type CreateUserBody,
} from '../../src/http/schemas.js'
import { isJsonValidRz } from '../../src/http/is-json-valid-rz.js'

/**
 * §4's claim: "One JSON Schema as the source of truth for runtime validation and
 * compile-time types." These are type-level assertions -- checked by `tsc`, with
 * vitest's expectTypeOf making the intent readable.
 */

test('required properties are non-optional and correctly typed', () => {
  expectTypeOf<CreateUserBody>().toHaveProperty('email').toEqualTypeOf<string>()
  expectTypeOf<CreateUserBody>().toHaveProperty('password').toEqualTypeOf<string>()
})

test('the nested address is inferred, not left as unknown', () => {
  expectTypeOf<CreateUserBody['address']>().toHaveProperty('line1').toEqualTypeOf<string>()
})

test('the ok channel is narrowed from unknown to the schema type', () => {
  const result = isJsonValidRz(createUserSchema)({} as unknown)
  if (result.isOk()) {
    expectTypeOf(result.value).toHaveProperty('email').toEqualTypeOf<string>()
  }
})

/**
 * THE INSURANCE.
 *
 * `isJsonValidRz` derives the body type from the schema, which removes the
 * mismatched-assertion hazard but introduces a quieter one: inference depends on
 * the schema being `as const`, and a missing `as const` degrades the body to
 * `unknown` with **no error anywhere**. Nothing in the compiler will tell you.
 *
 * These assertions are the thing that will. They fail loudly if a schema loses its
 * `as const`, which is the only way that regression becomes visible.
 */
test('INSURANCE: no validator silently degrades to unknown', () => {
  const bodyOf = <T>(_v: (b: unknown) => { isOk(): boolean } & { value?: T }): T => undefined as T

  expectTypeOf(bodyOf(isJsonValidRz(createUserSchema))).not.toBeUnknown()
  expectTypeOf(bodyOf(isJsonValidRz(createTransactionSchema))).not.toBeUnknown()
  expectTypeOf(bodyOf(isJsonValidRz(jwtPayloadSchema))).not.toBeUnknown()

  // And demonstrate the failure mode it guards against: the same schema without
  // `as const` really does produce `unknown`, with no diagnostic of its own.
  const widened = {
    type: 'object',
    required: ['email'],
    properties: { email: { type: 'string' } },
    additionalProperties: false,
  }
  expectTypeOf(bodyOf(isJsonValidRz(widened))).toBeUnknown()
})

test('the derived types are the specific ones, not just non-unknown', () => {
  const user = isJsonValidRz(createUserSchema)({} as unknown)
  if (user.isOk()) {
    expectTypeOf(user.value.address.town).toEqualTypeOf<string>()
  }
  const tx = isJsonValidRz(createTransactionSchema)({} as unknown)
  if (tx.isOk()) {
    // The enum narrows to a literal union, not `string` -- so the service layer's
    // `body.type === 'deposit'` branch is exhaustive.
    expectTypeOf(tx.value.type).toEqualTypeOf<'deposit' | 'withdrawal'>()
    expectTypeOf(tx.value.amount).toEqualTypeOf<number>()
  }
})

test('FRICTION: optional properties come back as `T | undefined`', () => {
  // json-schema-to-ts emits `line2?: string | undefined`. Under
  // exactOptionalPropertyTypes: true that is NOT the same as `line2?: string`,
  // and the difference shows up when you build one of these objects to hand to
  // a repository whose input type declares `line2?: string`. Documented rather
  // than worked around -- the point is that the two type systems do not line up
  // for free, which is the cost of the single-source-of-truth story.
  expectTypeOf<CreateUserBody['address']['line2']>().toEqualTypeOf<string | undefined>()
})

test('PROOF: a mismatched assertion no longer typechecks', () => {
  // Under the old `validator<T>(schema: object)` signature this line compiled
  // cleanly -- the asserted type and the validated schema were independent, so
  // nothing objected to validating a user body and calling it a transaction.
  //
  // Now the type is derived from the schema argument, so supplying a conflicting
  // one is an error. The `@ts-expect-error` is the assertion: if this ever starts
  // compiling, the binding has been lost and tsc will flag the unused directive.
  // @ts-expect-error -- createUserSchema is not assignable to CreateTransactionBody
  const wrong = isJsonValidRz<CreateTransactionBody>(createUserSchema)
  expect(typeof wrong).toBe('function')
})
