import { randomBytes } from 'node:crypto'

/**
 * Hex rather than `base64url`, which is the denser encoding and the one to reach for:
 * its alphabet includes `-` and `_`, and the published pattern for a user id is
 * `^usr-[A-Za-z0-9]+$`. The mismatch would not be silent — egress validation rejects
 * the response and answers 500 — but it would be a strange place to discover it.
 */
export const newUserId = (): string => `usr-${randomBytes(8).toString('hex')}`
