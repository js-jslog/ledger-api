import { hash } from 'bcryptjs'
import { ResultAsync } from 'neverthrow'

import { unexpected, type DomainError } from './errors.js'

/**
 * 12 is the working default; the suite sets 4 through `BCRYPT_COST` in
 * `vitest.config.ts`. Deliberately an environment variable rather than a
 * `NODE_ENV === 'test'` branch: a branch means the code the suite exercises is not the
 * code that runs, and exercising the second one is the suite's entire purpose.
 *
 * The cost is not decorative. Measured at cost 10, a hash is ~50–60ms and fully
 * serialised, so a suite creating users at 12 spends most of its time here.
 */
export const DEFAULT_BCRYPT_COST = 12

/**
 * Throws rather than returning a `Result`, which is the same call `migrateToLatest`
 * makes and for the same reason: a cost that does not parse is a broken configuration
 * rather than a request that failed, and there is no branch a caller could usefully
 * take. Silently falling back to the default would be worse than either — under test
 * that means a suite that quietly runs at 12 and is slow for no visible reason.
 */
export const bcryptCost = (env: NodeJS.ProcessEnv = process.env): number => {
  const configured = env['BCRYPT_COST']

  if (configured === undefined) return DEFAULT_BCRYPT_COST

  const cost = Number(configured)

  if (!Number.isInteger(cost) || cost < 4 || cost > 31) {
    throw new Error(`BCRYPT_COST must be an integer between 4 and 31, got "${configured}"`)
  }

  return cost
}

export const hash_passwordRzA = (plain: string): ResultAsync<string, DomainError> =>
  ResultAsync.fromPromise(hash(plain, bcryptCost()), unexpected)
