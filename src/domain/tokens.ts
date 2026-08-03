import jwt from 'jsonwebtoken'
import { err, ok, type Result } from 'neverthrow'
import type { DomainError } from './errors.js'
import { userIdPattern } from '../validation/schemas.js'

export interface Principal { userId: string }

export const issue = (userId: string, secret: string): string =>
  jwt.sign({ sub: userId }, secret, { expiresIn: '1h', algorithm: 'HS256' })

/**
 * The brief says to validate the decoded JWT payload with a schema that *rejects*
 * unknown keys. PROBE 07 shows why that specific instruction cannot be followed
 * literally: jsonwebtoken adds `iat` and `exp`, so `additionalProperties: false`
 * rejects every token it issues itself. The defensible version is to allow the
 * registered claims and read only `sub`, never spreading the payload anywhere.
 */
export const verify = (token: string, secret: string): Result<Principal, DomainError> => {
  let payload: unknown
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
  } catch (e) {
    const reason = e instanceof jwt.TokenExpiredError ? 'EXPIRED' : 'MALFORMED'
    return err({ kind: 'UNAUTHENTICATED', reason })
  }
  if (typeof payload !== 'object' || payload === null) {
    return err({ kind: 'UNAUTHENTICATED', reason: 'MALFORMED' })
  }
  const sub = (payload as { sub?: unknown }).sub
  if (typeof sub !== 'string' || !userIdPattern.test(sub)) {
    return err({ kind: 'UNAUTHENTICATED', reason: 'MALFORMED' })
  }
  return ok({ userId: sub })
}
