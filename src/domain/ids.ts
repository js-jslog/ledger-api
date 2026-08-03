import { randomBytes, randomInt } from 'node:crypto'

const suffix = () => randomBytes(6).toString('hex')

export const newUserId = () => `usr-${suffix()}`
export const newTransactionId = () => `tan-${suffix()}`

/**
 * The spec pins account numbers to `^01\d{6}$` — 10^6 possible values, and they are
 * the public identifier. Sequential allocation would make every other customer's
 * account trivially guessable; random allocation collides fast (birthday bound: 1%
 * chance of a collision by 142 accounts, 50% by 1,177). Either way the generator
 * needs a retry on unique-violation, which the brief does not currently record.
 */
export const newAccountNumber = () => `01${String(randomInt(0, 1_000_000)).padStart(6, '0')}`
