// PROBE 02 — Can the supplied OpenAPI component schemas be handed to Ajv as-is?
//
// The brief plans "Ajv for validation" and "schemas at every boundary with unknown
// keys rejected". The cheap path is to lift `components.schemas` out of the supplied
// spec. This probe establishes what that costs.
import { describe, expect, it } from 'vitest'
import { Ajv } from 'ajv'
import addFormatsModule from 'ajv-formats'

const addFormats = addFormatsModule as unknown as (a: Ajv) => Ajv

const strictAjv = () => addFormats(new Ajv({ strict: true }))

describe('the supplied spec uses `format` where it means `pattern`', () => {
  // Spec offenders: BankAccountResponse.accountNumber (`format: ^01\d{6}$`),
  // UserResponse.id, CreateUserRequest.phoneNumber, UpdateUserRequest.phoneNumber,
  // TransactionResponse.userId.
  it('throws in Ajv strict mode, which is the *good* outcome', () => {
    expect(() =>
      strictAjv().compile({ type: 'string', format: '^01\\d{6}$' }),
    ).toThrow(/unknown format/i)
  })

  it('but with strict mode off it silently validates nothing', () => {
    const validate = addFormats(new Ajv({ strict: false })).compile({
      type: 'string',
      format: '^01\\d{6}$',
    })
    expect(validate('banana')).toBe(true) // not an Eagle Bank account number
  })
})

describe('the spec ships a pattern that its own example violates', () => {
  it('transactionId `^tan-[A-Za-z0-9]$` matches only single-character ids', () => {
    const validate = strictAjv().compile({
      type: 'string',
      pattern: '^tan-[A-Za-z0-9]$',
    })
    expect(validate('tan-123abc')).toBe(false) // the spec's own documented example
    expect(validate('tan-1')).toBe(true)
  })
})

describe('money: the spec has no precision constraint on `amount`', () => {
  it('accepts sub-penny and zero-value transactions as written', () => {
    // CreateTransactionRequest.amount verbatim: number, minimum 0, maximum 10000.
    const validate = strictAjv().compile({ type: 'number', minimum: 0, maximum: 10000 })
    expect(validate(10.999)).toBe(true)
    expect(validate(0)).toBe(true)
    expect(validate(1e-9)).toBe(true) // converts to 0 pennies
  })

  it('DANGER: the obvious `multipleOf: 0.01` fix rejects 15.7% of valid amounts', () => {
    const validate = strictAjv().compile({ type: 'number', multipleOf: 0.01 })
    expect(validate(0.07)).toBe(false) // seven pence
    expect(validate(0.29)).toBe(false)
    expect(validate(1.11)).toBe(false)

    let rejected = 0
    for (let pence = 0; pence <= 1_000_000; pence++) {
      if (!validate(pence / 100)) rejected++
    }
    expect(rejected).toBe(157_274) // out of 1,000,001 legal GBP amounts
  })

  it('a string-representation guard is exact across the whole legal range', () => {
    const isPennyPrecise = (n: number) => /^\d+(\.\d{1,2})?$/.test(String(n))
    let rejected = 0
    for (let pence = 0; pence <= 1_000_000; pence++) {
      if (!isPennyPrecise(pence / 100)) rejected++
    }
    expect(rejected).toBe(0) // every legal GBP amount survives
    expect(isPennyPrecise(10.999)).toBe(false)
    expect(isPennyPrecise(1e-9)).toBe(false)
    expect(isPennyPrecise(1e21)).toBe(false) // stringifies as "1e+21"
  })

  it('UNFIXABLE at the schema layer: JSON.parse destroys precision first', () => {
    // No validator can reject this, because by the time Ajv runs the digits are gone.
    expect(JSON.parse('10.9999999999999999999')).toBe(11)
    // A client sending 11 pounds' worth of "almost 11" gets charged exactly 11.
  })
})
