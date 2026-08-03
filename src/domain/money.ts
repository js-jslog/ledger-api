import { err, ok, type Result } from 'neverthrow'
import type { DomainError } from './errors.js'

/**
 * The wire format is a JSON number of pounds (the spec allows nothing else). The
 * store is integer pennies. This module is the only place the two meet.
 *
 * PROBE 02 established that `multipleOf: 0.01` cannot express penny precision in
 * Ajv, and that `String(n)` is exact for all 1,000,001 legal amounts, so the guard
 * lives here in the domain rather than in the schema.
 */
const PENNY_PRECISE = /^\d+(\.\d{1,2})?$/

export const toPence = (pounds: number): Result<number, DomainError> => {
  if (!Number.isFinite(pounds) || !PENNY_PRECISE.test(String(pounds))) {
    return err({
      kind: 'VALIDATION',
      details: [{
        field: 'amount',
        message: 'must be a positive GBP amount with at most two decimal places',
        type: 'pennyPrecision',
      }],
    })
  }
  return ok(Math.round(pounds * 100))
}

/** Pennies back to pounds for the response. Exact for every value in range. */
export const toPounds = (pence: number): number => Number((pence / 100).toFixed(2))
