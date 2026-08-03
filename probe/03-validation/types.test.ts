import { expectTypeOf, test } from 'vitest'
import { createUserSchema, type CreateUserBody } from '../../src/http/schemas.js'
import { validator } from '../../src/http/validate.js'

/**
 * §4's claim: "One JSON Schema as the source of truth for runtime validation and
 * compile-time types." These are type-level assertions -- they are checked by
 * `tsc`, and vitest's expectTypeOf makes the intent readable.
 */

test('required properties are non-optional and correctly typed', () => {
  expectTypeOf<CreateUserBody>().toHaveProperty('email').toEqualTypeOf<string>()
  expectTypeOf<CreateUserBody>().toHaveProperty('password').toEqualTypeOf<string>()
})

test('the nested address is inferred, not left as unknown', () => {
  expectTypeOf<CreateUserBody['address']>().toHaveProperty('line1').toEqualTypeOf<string>()
})

test('the ok channel is narrowed from unknown to the schema type', () => {
  const result = validator<CreateUserBody>(createUserSchema)({} as unknown)
  if (result.isOk()) {
    expectTypeOf(result.value).toHaveProperty('email').toEqualTypeOf<string>()
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
