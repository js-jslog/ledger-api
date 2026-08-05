import { err, ok, type Result } from 'neverthrow'

import { validationFailed, type DomainError } from './errors.js'

declare const brand: unique symbol

/**
 * Money is an integer count of pennies everywhere inside the service boundary. The brand
 * is what stops a plain `number` — an amount in pounds, say — being passed where pennies
 * are expected, which is otherwise a silent arithmetic error a hundred times too small.
 */
export type Pennies = number & { readonly [brand]: 'Pennies' }

const AMOUNT_FIELD = 'amount'

/**
 * The scale check itself, shared with the Ajv `currencyScale` keyword so that the two
 * places the property is asserted cannot disagree about what it means. R11 records that
 * it is asserted twice; this is why that is duplication of the assertion rather than of
 * the rule.
 *
 * The tolerance is chosen for a scale of 2, which is the only scale this service uses.
 */
export const isWithinScale = (amount: number, scale: number): boolean => {
  const scaled = amount * 10 ** scale

  // A non-finite amount needs no guard and had one until it was measured. `Infinity`
  // scales to `Infinity`, `Infinity - Infinity` is `NaN`, and every comparison against
  // `NaN` is false — so it is rejected by the arithmetic rather than by a branch. The
  // test asserting that is what stands in the deleted guard's place.
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6
}

/**
 * The only decimal→integer conversion in the codebase, and therefore also the only
 * two-decimal-place validator: there is no way to obtain `Pennies` without having passed
 * the check, so the two cannot drift apart.
 *
 * Round first, then assert the rounding moved the value by less than a fraction of a
 * penny. The obvious alternative, `Number.isInteger(amount * 100)`, is nastily broken
 * rather than merely imperfect — the spot-checks a reader would try all pass
 * (`10.99 * 100 === 1099`) while `0.29 * 100` is `28.999999999999996`. It wrongly rejects
 * 131,256 of the 1,000,001 legal amounts, and `multipleOf: 0.01` rejects 157,274.
 * Asserted over the whole range in `money.test.ts` rather than argued here.
 */
export const toPennies = (amount: number): Result<Pennies, DomainError> => {
  // `1e999` is a legal JSON number that parses to `Infinity`, so this cannot be left to
  // a `maximum` keyword.
  if (!Number.isFinite(amount)) {
    return err(invalidAmount('must be a finite number'))
  }

  if (!isWithinScale(amount, 2)) {
    return err(invalidAmount('must have no more than 2 decimal places'))
  }

  const pennies = Math.round(amount * 100)

  // `Math.round(-0 * 100)` is `-0`, and `Object.is(-0, 0)` is false, so a signed zero
  // would survive into an equality assertion and into the database.
  return ok((pennies === 0 ? 0 : pennies) as Pennies)
}

const invalidAmount = (message: string): DomainError =>
  validationFailed('Invalid request body', [
    { field: AMOUNT_FIELD, message, type: 'currencyScale' },
  ])
