import { randomBytes, randomInt } from 'node:crypto'

/**
 * Hex rather than `base64url`, which is the denser encoding and the one to reach for:
 * its alphabet includes `-` and `_`, and the published pattern for a user id is
 * `^usr-[A-Za-z0-9]+$`. The mismatch would not be silent — egress validation rejects
 * the response and answers 500 — but it would be a strange place to discover it.
 */
export const newUserId = (): string => `usr-${randomBytes(8).toString('hex')}`

/**
 * `^01\d{6}$` — six digits after a fixed prefix, so there are one million of them and a
 * collision is an ordinary event rather than a theoretical one. That is the whole reason
 * the account repository inserts under a retry loop where the users repository does not:
 * a 16-byte user id is unique by construction, and this is unique by checking.
 *
 * `randomInt` rather than `Math.random`, for uniformity rather than for unpredictability —
 * an account number is not a secret, but a skewed generator raises the collision rate the
 * retry loop exists to absorb.
 */
export const newAccountNumber = (): string => `01${String(randomInt(1_000_000)).padStart(6, '0')}`

/**
 * The user id's shape rather than the account number's, and the choice is the interesting
 * part: the published pattern `^tan-[A-Za-z0-9]+$` would admit six digits just as happily.
 * Sixteen hex characters is unique by construction, which is what keeps this repository's
 * insert a plain insert — the retry loop above exists because six digits collide, and
 * nothing about a transaction id makes it worth paying that.
 */
export const newTransactionId = (): string => `tan-${randomBytes(8).toString('hex')}`
