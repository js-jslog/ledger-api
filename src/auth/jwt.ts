import jwt from 'jsonwebtoken'
import { err, ok, type Result } from 'neverthrow'
import { unauthenticated, type DomainError } from '../domain/errors.js'
import { jwtPayloadSchema, type JwtPayload } from '../http/schemas.js'
import { validator } from '../http/validate.js'

/**
 * Token issue and verify.
 *
 * §9: "ship issue/verify with expiry and explicit algorithm; defer clock-skew
 * tolerance, refresh, and anything beyond rejecting `alg: none`."
 *
 * Note §4's closed-decisions table names no JWT library. `jsonwebtoken` is used
 * here; it is CJS, so it needs the same default-import care as ajv-formats.
 */

const ALGORITHM = 'HS256' as const
const TTL_SECONDS = 15 * 60

/**
 * §3: "No signing key, secret or credential committed to the repository."
 *
 * The dangerous shape is `process.env.JWT_SECRET ?? 'dev-secret'`, which keeps
 * the app booting on a developer machine and ships a known signing key. Reading
 * the secret through a function that throws means a missing secret is a loud
 * startup failure instead.
 */
export function signingSecret(): string {
  const secret = process.env.JWT_SECRET
  if (secret === undefined || secret.length === 0) {
    throw new Error('JWT_SECRET is not set')
  }
  return secret
}

export function issueToken(userId: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000)
  return jwt.sign(
    // `iat` and `exp` are set explicitly rather than via the `expiresIn` option,
    // so the payload the verifier validates has exactly the declared shape and
    // nothing else. jsonwebtoken would otherwise add `iat` itself.
    { sub: userId, iat: issuedAt, exp: issuedAt + TTL_SECONDS },
    signingSecret(),
    { algorithm: ALGORITHM },
  )
}

const validatePayload = validator<JwtPayload>(jwtPayloadSchema)

export function verifyToken(token: string): Result<JwtPayload, DomainError> {
  let decoded: unknown
  try {
    decoded = jwt.verify(token, signingSecret(), {
      // Explicit algorithm list. This is what rejects `alg: none` and any
      // algorithm-substitution attempt, rather than trusting the token's header.
      algorithms: [ALGORITHM],
    })
  } catch (e) {
    // jsonwebtoken throws for expiry, bad signature and malformed input alike.
    // All three are the same 401 to the client; the distinction is log-only.
    return err(unauthenticated(e instanceof Error ? e.name : 'invalid token'))
  }

  // §3: "The decoded JWT payload is validated as untrusted input, and its schema
  // must declare `iat` and `exp` or it fails its own `additionalProperties:
  // false`." A verified signature proves the token came from us; it proves
  // nothing about the shape of what we put in it three releases ago.
  return validatePayload(decoded).mapErr(() => unauthenticated('malformed token payload'))
}

/** Extracts a bearer token from an Authorization header. */
export function bearerToken(header: string | undefined): Result<string, DomainError> {
  if (header === undefined) return err(unauthenticated('missing Authorization header'))
  // RFC 7235 makes the scheme case-insensitive, so "bearer" must work too.
  const match = /^Bearer +(.+)$/i.exec(header.trim())
  if (match?.[1] === undefined) return err(unauthenticated('malformed Authorization header'))
  return ok(match[1])
}
