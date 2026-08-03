import { Ajv } from 'ajv'
import { describe, expect, test } from 'vitest'

/**
 * §4: "Do not use `multipleOf: 0.01` for 2dp validation; it rejects `0.29`.
 * **[verified]**"
 *
 * Correct, and the brief stops there. But 2dp validation is a hard requirement:
 * the spec describes `amount` as "Currency amount with up to two decimal
 * places", and §3 requires that money never appears as a decimal inside the
 * service boundary -- so something at the ingress boundary has to reject 10.999
 * and convert 10.99 to 1099. The brief names no mechanism. This probe finds one.
 */

describe('multipleOf: 0.01 -- the rejected option', () => {
  const validate = new Ajv().compile({ type: 'number', multipleOf: 0.01 })

  test('rejects legitimate 2dp amounts, and 0.29 is not the only one', () => {
    const wronglyRejected: number[] = []
    for (let pennies = 0; pennies <= 1_000_000; pennies++) {
      const amount = pennies / 100
      if (!validate(amount)) wronglyRejected.push(amount)
    }
    // Every one of these is a legal GBP amount inside the spec's range. The
    // brief says "it rejects 0.29", which is true but understates the scale by
    // five orders of magnitude: it rejects 15.7% of all legal amounts.
    expect(wronglyRejected).toContain(0.29)
    expect(wronglyRejected.length).toBe(157_274)
    console.log(
      `multipleOf: 0.01 wrongly rejects ${wronglyRejected.length} of 1000001 legal amounts,` +
        ` e.g. ${wronglyRejected.slice(0, 8).join(', ')}`,
    )
  })
})

describe('the naive 2dp check is broken in the OTHER direction', () => {
  test('Number.isInteger(amount * 100) also rejects legal amounts', () => {
    // This is the check almost everyone reaches for once multipleOf is ruled
    // out, and the one an AI assistant is most likely to produce. It is wrong
    // for the same floating-point reason multipleOf is wrong -- and note it is
    // NOT wrong for 10.99, which multiplies exactly. It is wrong for 0.29,
    // whose product is 28.999999999999996. Spot-checking a couple of amounts is
    // exactly how you would convince yourself this check works.
    const wronglyRejected: number[] = []
    for (let pennies = 0; pennies <= 1_000_000; pennies++) {
      const amount = pennies / 100
      if (!Number.isInteger(amount * 100)) wronglyRejected.push(amount)
    }
    expect(10.99 * 100).toBe(1099) // the obvious spot-check passes
    expect(wronglyRejected).toContain(0.29) // ...and 131255 others do not
    expect(wronglyRejected.length).toBe(131_256)
    console.log(
      `Number.isInteger(x*100) wrongly rejects ${wronglyRejected.length} of 1000001,` +
        ` e.g. ${wronglyRejected.slice(0, 8).join(', ')}`,
    )
  })
})

/**
 * The mechanism that does work: round first, then assert the rounding moved the
 * value by less than half a penny of slack. `Math.round` is exact for every 2dp
 * double in this range; the epsilon only has to absorb the representation error,
 * which is ~1e-13 at most at this magnitude.
 */
export function toPennies(amount: number): number | null {
  if (!Number.isFinite(amount)) return null
  const scaled = amount * 100
  const pennies = Math.round(scaled)
  if (Math.abs(scaled - pennies) > 1e-6) return null // more than 2dp of precision
  // Math.round(-0 * 100) is -0, and Object.is(-0, 0) is false. Left alone, a
  // signed zero survives into comparisons and assertions as a value equal to
  // zero under `==` but not under Object.is or toBe.
  return pennies === 0 ? 0 : pennies
}

describe('toPennies -- round, then check the slack', () => {
  test('accepts every legal 2dp amount in the spec range and is exact', () => {
    // Collect then assert once: a million expect() calls costs more than the
    // arithmetic and trips the default 5s timeout.
    const mismatches: { amount: number; got: number | null; want: number }[] = []
    for (let pennies = 0; pennies <= 1_000_000; pennies++) {
      const amount = pennies / 100
      const got = toPennies(amount)
      if (got !== pennies) mismatches.push({ amount, got, want: pennies })
    }
    expect(mismatches).toEqual([])
  })

  test('rejects more than two decimal places', () => {
    for (const bad of [10.999, 0.001, 1.005, 3.14159, 0.125]) {
      expect(toPennies(bad), `${bad}`).toBeNull()
    }
  })

  test('handles the JSON number forms that are easy to forget', () => {
    expect(toPennies(1e2)).toBe(10_000) // exponent notation is valid JSON
    expect(toPennies(-0)).toBe(0) // negative zero normalises
    expect(toPennies(Number('1e999'))).toBeNull() // overflows to Infinity
    expect(toPennies(1.0)).toBe(100) // trailing .0 is indistinguishable from int
  })
})

describe('what Ajv can and cannot do at the schema layer', () => {
  test('a `pattern` keyword is silently ignored on a number', () => {
    // The tempting fix -- reuse the string-pattern machinery -- does nothing.
    // `pattern` only applies to strings, so this schema accepts anything numeric
    // and gives false confidence.
    const validate = new Ajv().compile({ type: 'number', pattern: '^\\d+\\.\\d{2}$' })
    expect(validate(10.999)).toBe(true)
  })

  test('a custom keyword puts the working check back into the schema', () => {
    // Keeps the single-source-of-truth story intact: 2dp-ness stays declared in
    // the schema rather than becoming a hand-written service-layer check.
    const ajv = new Ajv()
    ajv.addKeyword({
      keyword: 'currencyScale',
      type: 'number',
      schemaType: 'number',
      validate: (scale: number, data: number) => {
        const factor = 10 ** scale
        return Math.abs(data * factor - Math.round(data * factor)) <= 1e-6
      },
    })
    const validate = ajv.compile({
      type: 'number',
      minimum: 0,
      maximum: 10_000,
      currencyScale: 2,
    })
    expect(validate(10.99)).toBe(true)
    expect(validate(0.29)).toBe(true)
    expect(validate(10.999)).toBe(false)
    expect(validate(20_000)).toBe(false)
  })
})
