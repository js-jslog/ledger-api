import { randomBytes, randomInt } from 'node:crypto'

const suffix = () => randomBytes(6).toString('hex')

export const newUserId = () => `usr-${suffix()}`
export const newTransactionId = () => `tan-${suffix()}`

/**
 * The spec pins account numbers to `^01\d{6}$` — 10^6 possible values, and they are
 * the public identifier. Sequential allocation would make every other customer's
 * account trivially guessable; random allocation collides (birthday bound: a ~1%
 * chance of collision by ~4,500 accounts). Either way the generator needs a retry
 * on unique-violation, which is a decision the brief does not currently record.
 */
export const newAccountNumber = () => `01${String(randomInt(0, 1_000_000)).padStart(6, '0')}`
