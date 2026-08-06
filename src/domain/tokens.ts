import { randomBytes } from 'node:crypto'

import { SignJWT, jwtVerify } from 'jose'
import { ResultAsync } from 'neverthrow'

import { tokenClaimsSchema } from '../http/schemas.js'
import { validatorFor } from '../http/validator-for.js'
import { unauthenticated, unexpected, type DomainError } from './errors.js'

/**
 * Generated once per process, and there is deliberately no environment variable, no
 * default and no committed fallback. Section 3's "no signing key, secret or credential
 * committed" is then satisfied by there being nothing to commit, and a fresh clone works
 * with nothing configured.
 *
 * The cost is real and is stated in the README: a restart invalidates every issued token.
 * R32 carries the reasoning, including why this is the one configurable-looking value that
 * is not configurable.
 */
const signingKey = randomBytes(32)

/**
 * Pinned at both ends, and the honest account of why is weaker than the usual one.
 *
 * The usual argument is that without an explicit `algorithms` list, verification trusts the
 * `alg` header of the token under test — attacker-controlled input — so `alg: none` and
 * HMAC-versus-RSA confusion both get through. **Measured against jose 6, and it does not
 * hold here.** An unsecured token is refused with `JOSENotSupported` whether or not the
 * list is given, and passing a `Uint8Array` key forecloses the asymmetric confusion outright
 * because there is no public key to substitute in.
 *
 * So this is defence in depth rather than the thing standing between here and a forgery. It
 * stays because it costs nothing and because it stops being redundant the moment the key
 * becomes a `KeyObject` — but a comment claiming it is load-bearing would be false.
 */
const ALGORITHM = 'HS256'

/** Minimal, and R38 records what a production service would add. */
const LIFETIME = '1h'

const validateClaims = validatorFor(tokenClaimsSchema)

export const issue_tokenRzA = (userId: string): ResultAsync<string, DomainError> =>
  ResultAsync.fromPromise(
    new SignJWT()
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(LIFETIME)
      .sign(signingKey),
    unexpected,
  )

/**
 * Every failure below is one `Unauthenticated`, including a payload that verified
 * cryptographically and then failed its schema. That last case is this service's own bug
 * rather than the client's, so 500 is arguable — but the client supplied the token, cannot
 * act on the distinction, and telling it which claim was wrong is an oracle for how tokens
 * are shaped. The diagnostic is not lost: `validateClaims` logs the offending field names
 * as it constructs its own error, one record before this one.
 */
/**
 * The class name and never the message, which is the same discipline the malformed-JSON
 * branch arrived at in slice 1: body-parser's `SyntaxError` embeds a fragment of the body
 * it failed to parse, and the fragment could be a password. jose's messages are fixed
 * strings today — measured, see docs/divergences.md § Slice 3 — but a bearer token is a
 * credential, and "this library does not currently echo its input" is a property of a
 * version rather than of the code here.
 */
const reasonFor = (cause: unknown): string => (cause instanceof Error ? cause.name : 'NonError')

export const verify_tokenRzA = (token: string): ResultAsync<string, DomainError> =>
  ResultAsync.fromPromise(jwtVerify(token, signingKey, { algorithms: [ALGORITHM] }), (cause) =>
    unauthenticated({ reason: reasonFor(cause) }),
  )
    .andThen((verified) =>
      validateClaims(verified.payload).mapErr(() => unauthenticated({ reason: 'ClaimsRejected' })),
    )
    .map((claims) => claims.sub)
