import { Ajv } from 'ajv'
import { describe, expect, test } from 'vitest'

import { capturedLogs } from '../../test/observability/captured-logs.js'
import { OUTSIDE_REQUEST } from '../observability/correlation.js'
import { isWithinScale, toDecimal, toPennies, type Pennies } from './money.js'

capturedLogs()

/**
 * The specification caps a transaction at 10000.00, so there are exactly 1,000,001 legal
 * two-decimal-place amounts. Small enough to check all of them, which is the only reason
 * the claims below are numbers rather than adjectives.
 */
const LEGAL_AMOUNTS = 1_000_001

const legalAmounts = function* (): Generator<{ amount: number; pennies: number }> {
  for (let pennies = 0; pennies < LEGAL_AMOUNTS; pennies++) {
    yield { amount: pennies / 100, pennies }
  }
}

describe('toPennies', () => {
  test('converts every legal amount in the published range exactly', () => {
    const failures: number[] = []

    for (const { amount, pennies } of legalAmounts()) {
      const penniesRz = toPennies(amount)

      if (penniesRz.isErr() || penniesRz.value !== pennies) failures.push(amount)
    }

    expect(failures).toEqual([])
  })

  test('rejects more than two decimal places', () => {
    expect(toPennies(10.999)._unsafeUnwrapErr()).toEqual({
      kind: 'ValidationFailed',
      message: 'Invalid request body',
      correlationId: OUTSIDE_REQUEST,
      details: [
        {
          field: 'amount',
          message: 'must have no more than 2 decimal places',
          type: 'currencyScale',
        },
      ],
    })
  })

  test('rejects a non-finite amount with a message that says so', () => {
    // `1e999` is a legal JSON number and parses to `Infinity`, which no `maximum` keyword
    // would catch. The scale check alone would already reject it — so what the finiteness
    // branch in `toPennies` earns is the right MESSAGE, not the rejection.
    const parsed = JSON.parse('{"amount":1e999}') as { amount: number }

    expect(parsed.amount).toBe(Number.POSITIVE_INFINITY)
    expect(toPennies(parsed.amount)._unsafeUnwrapErr()).toEqual({
      kind: 'ValidationFailed',
      message: 'Invalid request body',
      correlationId: OUTSIDE_REQUEST,
      details: [{ field: 'amount', message: 'must be a finite number', type: 'currencyScale' }],
    })
  })

  test('rejects a non-finite amount without needing a branch to do it', () => {
    // `isWithinScale` carries no finiteness guard, because it does not need one: the
    // arithmetic produces `NaN` and every comparison against `NaN` is false. This is the
    // assertion that justifies the absent guard, and it fails if anyone reinstates one
    // that changes the answer.
    expect(isWithinScale(Number.POSITIVE_INFINITY, 2)).toBe(false)
    expect(isWithinScale(Number.NEGATIVE_INFINITY, 2)).toBe(false)
    expect(isWithinScale(Number.NaN, 2)).toBe(false)
  })

  test('accepts exponent notation, which is also a legal JSON number', () => {
    expect(toPennies(1e2)._unsafeUnwrap()).toBe(10_000)
  })

  test('normalises negative zero', () => {
    // `Math.round(-0 * 100)` is `-0`, and `Object.is(-0, 0)` is false — so without the
    // normalisation a signed zero survives into an equality assertion and into a column.
    expect(Object.is(toPennies(-0)._unsafeUnwrap(), 0)).toBe(true)
  })
})

/**
 * The two mechanisms a reader would reach for first, and the reason the codebase uses
 * neither. Both are checked over the same 1,000,001 amounts, so these numbers are
 * measurements rather than claims — and they are here rather than in prose because a
 * number in a comment is a number nobody re-checks.
 */
/**
 * The inverse, and the reason it gets the same exhaustive treatment as `toPennies` rather
 * than a spot-check: this is the first thing in the codebase that renders money, and a
 * balance that is wrong in the last penny is wrong in the way nobody notices.
 */
describe('toDecimal', () => {
  test('round-trips every legal amount in the published range', () => {
    const failures: number[] = []

    for (const { pennies } of legalAmounts()) {
      const penniesRz = toPennies(toDecimal(pennies as Pennies))

      if (penniesRz.isErr() || penniesRz.value !== pennies) failures.push(pennies)
    }

    expect(failures).toEqual([])
  })

  /**
   * The property that actually reaches a client, which is not the same claim as the one
   * above: the round trip could hold while `JSON.stringify` emitted `10.990000000000002`.
   * What a caller receives is the serialised form, so that is what is asserted.
   */
  test('serialises every legal amount as at most two decimal places', () => {
    const failures: string[] = []

    for (const { pennies } of legalAmounts()) {
      const serialised = JSON.stringify(toDecimal(pennies as Pennies))

      if (!/^\d+(\.\d{1,2})?$/.test(serialised)) failures.push(serialised)
    }

    expect(failures).toEqual([])
  })

  test('renders the amounts a reader would spot-check', () => {
    expect(toDecimal(0 as Pennies)).toBe(0)
    expect(toDecimal(29 as Pennies)).toBe(0.29)
    expect(toDecimal(1099 as Pennies)).toBe(10.99)
    expect(toDecimal(1_000_000 as Pennies)).toBe(10_000)
  })

  /**
   * The ceiling is the `integer` column rather than the specification's transaction cap,
   * so it is checked where it actually stops: `2147483647` pennies is a shade over £21.4m,
   * and the conversion is still exact there.
   */
  test('is exact at the largest balance the column can hold', () => {
    const largest = 2_147_483_647 as Pennies

    expect(JSON.stringify(toDecimal(largest))).toBe('21474836.47')
    expect(toPennies(toDecimal(largest))._unsafeUnwrap()).toBe(largest)
  })
})

describe('the rejected alternatives', () => {
  test('Number.isInteger(amount * 100) wrongly rejects 131,256 legal amounts', () => {
    let rejected = 0

    for (const { amount } of legalAmounts()) {
      if (!Number.isInteger(amount * 100)) rejected++
    }

    // The spot-checks a reader would try all pass, which is what makes this the
    // dangerous option rather than merely the wrong one.
    expect(Number.isInteger(10.99 * 100)).toBe(true)
    expect(0.29 * 100).toBe(28.999999999999996)

    expect(rejected).toBe(131_256)
  })

  test('multipleOf: 0.01 wrongly rejects 157,274 legal amounts', () => {
    const validate = new Ajv({ strict: true }).compile({ type: 'number', multipleOf: 0.01 })

    let rejected = 0

    for (const { amount } of legalAmounts()) {
      if (!validate(amount)) rejected++
    }

    expect(rejected).toBe(157_274)
  })
})
