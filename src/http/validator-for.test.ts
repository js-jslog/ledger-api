import { describe, expect, test } from 'vitest'

import { validatorFor } from './validator-for.js'

// `as const` is load-bearing, not stylistic: without it the literal types widen,
// `FromSchema` has nothing to work from, and the validated body degrades to `unknown`
// SILENTLY. See validator-for.type-assertions.ts, which is what stands where the
// compiler will not.
//
// `satisfies Record<string, unknown>` rather than `satisfies JSONSchema`, because the
// stricter guard rejects custom Ajv keywords, and one is coming for two-decimal-place
// amounts.
const signupSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password', 'address'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 12 },
    balance: { type: 'number' },
    address: {
      type: 'object',
      // Not inherited from the parent. Without this line, `{ line1: 'x', isAdmin: true }`
      // validates, and the mass-assignment hole is open on the nested object while the
      // top level looks protected.
      additionalProperties: false,
      required: ['line1'],
      properties: { line1: { type: 'string' } },
    },
  },
} as const satisfies Record<string, unknown>

const validate_signupRz = validatorFor(signupSchema)

const valid = {
  email: 'someone@example.com',
  password: 'a-long-enough-password',
  address: { line1: '1 High Street' },
}

describe('validatorFor', () => {
  test('accepts a valid body and hands back a readable value', () => {
    const signupRz = validate_signupRz(valid)

    expect(signupRz.isOk()).toBe(true)
    // Reading a field proves the compile-time half works too. If the body had degraded
    // to `unknown`, this line would not compile.
    expect(signupRz._unsafeUnwrap().address.line1).toBe('1 High Street')
  })

  test('rejects an unknown key at the top level, naming it', () => {
    const signupRz = validate_signupRz({ ...valid, isAdmin: true })

    expect(signupRz.isErr()).toBe(true)
    expect(signupRz._unsafeUnwrapErr().details).toEqual([
      { field: 'isAdmin', message: 'must NOT have additional properties', type: 'additionalProperties' },
    ])
  })

  test('rejects an unknown key on a NESTED object', () => {
    const signupRz = validate_signupRz({
      ...valid,
      address: { line1: '1 High Street', isAdmin: true },
    })

    expect(signupRz.isErr()).toBe(true)
    expect(signupRz._unsafeUnwrapErr().details).toEqual([
      { field: 'address.isAdmin', message: 'must NOT have additional properties', type: 'additionalProperties' },
    ])
  })

  test('treats __proto__ as an unknown key without polluting the prototype', () => {
    const signupRz = validate_signupRz(JSON.parse('{"__proto__":{"isAdmin":true}}') as unknown)

    expect(signupRz.isErr()).toBe(true)
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined()
  })

  test('does not coerce a string into a number', () => {
    const signupRz = validate_signupRz({ ...valid, balance: '1000' })

    expect(signupRz.isErr()).toBe(true)
    expect(signupRz._unsafeUnwrapErr().details).toEqual([
      { field: 'balance', message: 'must be number', type: 'type' },
    ])
  })

  test('names every missing required property rather than stopping at the first', () => {
    const signupRz = validate_signupRz({})

    const fields = signupRz._unsafeUnwrapErr().details.map((d) => d.field)
    expect(fields).toEqual(['email', 'password', 'address'])
  })

  test('rejects an absent body rather than throwing', () => {
    // A request with `content-type: text/plain`, or none, leaves `req.body` as
    // `undefined` rather than `{}`. Unhandled, that is a 500 where a 400 belongs.
    expect(() => validate_signupRz(undefined)).not.toThrow()
    expect(validate_signupRz(undefined).isErr()).toBe(true)
  })

  // `strict: true` was the one Ajv option no test protected, and it is the one that
  // matters most: it decides whether a malformed schema fails loudly at startup or
  // silently validates nothing. Both cases below throw when the schema is compiled,
  // which is at module load in production — so the failure lands before a request is
  // ever served.
  describe('the Ajv instance is strict', () => {
    test('refuses a schema with a regex left in a format keyword', () => {
      // The supplied specification does this in six places, meaning `pattern`. Under
      // `strict: false` this compiles and then checks nothing at all, so
      // `accountNumber: "GARBAGE"` would pass validation.
      expect(() =>
        validatorFor({
          type: 'object',
          properties: { accountNumber: { type: 'string', format: '^01\\d{6}$' } },
        } as const satisfies Record<string, unknown>),
      ).toThrow(/format/)
    })

    test('refuses a schema carrying an unknown keyword', () => {
      // The good failure mode for a custom keyword that has not been registered yet:
      // a loud throw rather than silent acceptance of what the keyword was meant to
      // reject.
      expect(() =>
        validatorFor({
          type: 'object',
          properties: { amount: { type: 'number', currencyScale: 2 } },
        } as const satisfies Record<string, unknown>),
      ).toThrow(/unknown keyword/)
    })
  })

  test('reports the offending field and keyword but never the offending value', () => {
    const secret = 'short'
    const signupRz = validate_signupRz({ ...valid, password: secret })

    const [detail] = signupRz._unsafeUnwrapErr().details
    expect(detail).toEqual({
      field: 'password',
      message: 'must NOT have fewer than 12 characters',
      type: 'minLength',
    })
    // The whole reason `toFieldError` reads `message` and `keyword` and not `params`.
    expect(JSON.stringify(signupRz._unsafeUnwrapErr())).not.toContain(secret)
  })
})
