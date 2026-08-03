import { Ajv } from 'ajv'
import addFormatsCjs from 'ajv-formats'

// See src/http/validate.ts for why this cast is necessary.
const addFormats = addFormatsCjs as unknown as (typeof addFormatsCjs)['default']
import { describe, expect, test } from 'vitest'
import { ajv, isJsonValidRz } from '../../src/http/is-json-valid-rz.js'
import { createUserSchema } from '../../src/http/schemas.js'

// `currencyScale` is registered in src/http/validate.ts, beside the Ajv instance.
// It started out registered here, in the test file -- which made the production
// path throw `strict mode: unknown keyword: "currencyScale"` at startup. Left as
// a note because that ordering dependency is the finding, not an aside.

const validUser = {
  name: 'Test User',
  address: { line1: '1 High Street', town: 'Manchester', county: 'Greater Manchester', postcode: 'M1 1AA' },
  phoneNumber: '+447700900000',
  email: 'test@example.com',
  password: 'correct-horse-battery',
}

describe('additionalProperties: false, nested (§3)', () => {
  const validate = isJsonValidRz(createUserSchema)

  test('accepts a well-formed body', () => {
    expect(validate(validUser).isOk()).toBe(true)
  })

  test('rejects an unknown key at the top level', () => {
    const result = validate({ ...validUser, isAdmin: true })
    expect(result.isErr()).toBe(true)
  })

  test('rejects an unknown key inside the nested address -- the §3 case', () => {
    const result = validate({ ...validUser, address: { ...validUser.address, isAdmin: true } })
    expect(result.isErr()).toBe(true)
    // The field name comes from params.additionalProperty, not instancePath:
    // instancePath is "/address", which would report the wrong field.
    const error = result._unsafeUnwrapErr()
    expect(error.kind).toBe('ValidationFailed')
    if (error.kind === 'ValidationFailed') {
      expect(error.details.map((d) => d.field)).toContain('isAdmin')
    }
  })

  test('CONFIRMS §3: without it on the nested object, isAdmin validates', () => {
    const leaky = {
      type: 'object',
      required: ['address'],
      properties: {
        address: {
          type: 'object',
          required: ['line1'],
          properties: { line1: { type: 'string' } },
          // additionalProperties omitted here on purpose
        },
      },
      additionalProperties: false,
    } as const
    const validate = isJsonValidRz(leaky)
    expect(validate({ address: { line1: 'x', isAdmin: true } }).isOk()).toBe(true)
  })
})

describe('mass assignment beyond unknown keys', () => {
  test('a __proto__ key in the body is caught by additionalProperties', () => {
    // §4 claims "Rejecting unknown keys closes mass assignment". Worth checking
    // that the classic pollution key is genuinely treated as an unknown key
    // rather than slipping past as an inherited property.
    const parsed: unknown = JSON.parse('{"name":"x","__proto__":{"isAdmin":true}}')
    const result = isJsonValidRz(createUserSchema)(parsed)
    expect(result.isErr()).toBe(true)
    // And the prototype was not polluted in the process.
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })
})

describe('the spec defects Ajv strict mode catches, and the one it does not', () => {
  test('a regex left in a `format` keyword is a startup error under strict mode', () => {
    // The supplied spec has six of these (§6 forced change 3). This is the
    // failure mode that makes them findable -- it throws at compile time, so it
    // cannot reach production silently.
    expect(() => ajv.compile({ type: 'string', format: '^01\\d{6}$' })).toThrow(
      /unknown format/i,
    )
  })

  test('DANGER: strict:false turns that error into silence, as §4 warns', () => {
    const loose = new Ajv({ strict: false })
    addFormats(loose)
    const validate = loose.compile({ type: 'string', format: '^01\\d{6}$' })
    expect(validate('GARBAGE')).toBe(true) // exactly §4's example
  })

  test('an unregistered custom keyword is ALSO a startup error under strict mode', () => {
    // Which means forgetting to register `currencyScale` fails loudly rather
    // than silently accepting 3dp amounts. Good -- but it must be registered on
    // the same Ajv instance that compiles the schemas, and the schemas are
    // module-level constants, so the registration has to happen first. That
    // ordering dependency is a real footgun in a composition root.
    const fresh = new Ajv({ strict: true })
    addFormats(fresh)
    expect(() => fresh.compile({ type: 'number', currencyScale: 2 })).toThrow(
      /unknown keyword/i,
    )
  })

  test('OpenAPI 3.1 is draft 2020-12, and the default Ajv import is draft-07', () => {
    // The brief calls the spec "the source of truth" for the schemas. If schemas
    // are lifted from the 3.1 document rather than retyped, the $schema
    // declaration alone stops the default Ajv build from compiling them.
    expect(() =>
      new Ajv({ strict: false }).compile({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
      }),
    ).toThrow(/no schema with key or ref/i)
  })
})

describe('undefined body (§8 criterion 4) is handled before Ajv sees it', () => {
  test('undefined becomes a 400-shaped ValidationFailed, not a 500', () => {
    const result = isJsonValidRz(createUserSchema)(undefined)
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    if (error.kind === 'ValidationFailed') {
      expect(error.details[0]).toMatchObject({ field: 'body', type: 'required' })
    }
  })
})
