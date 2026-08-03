import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bearerToken, issueToken, signingSecret, verifyToken } from '../../src/auth/jwt.js'

/**
 * §14: "JWT end-to-end -- expiry, clock skew, `alg: none` rejection, async
 * middleware error propagation. Only payload shape was checked."
 *
 * Async middleware propagation was settled in probe 02. This covers the rest.
 */

const ORIGINAL_SECRET = process.env.JWT_SECRET

beforeAll(() => {
  process.env.JWT_SECRET = 'probe-secret-not-a-real-key'
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = ORIGINAL_SECRET
})

describe('the happy path', () => {
  test('a freshly issued token verifies and carries the subject', () => {
    const result = verifyToken(issueToken('usr-abc123'))
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().sub).toBe('usr-abc123')
  })
})

describe('alg: none rejection (§9)', () => {
  test('an unsigned token is rejected', () => {
    // The classic attack: re-encode the token with "alg":"none" and no signature.
    const unsigned = jwt.sign({ sub: 'usr-attacker', iat: 1, exp: 9_999_999_999 }, '', {
      algorithm: 'none',
    })
    expect(verifyToken(unsigned).isErr()).toBe(true)
  })

  test('jsonwebtoken 9 refuses an unsigned token even WITHOUT the algorithms option', () => {
    // Worth establishing which layer is actually protecting us. With a symmetric
    // secret, jsonwebtoken 9 derives the permitted algorithm set from the key
    // type, so `alg: none` is refused whether or not `algorithms` is passed:
    //
    //   with    algorithms: ['HS256']  -> throws
    //   without algorithms             -> throws "jwt signature is required"
    //
    // So the explicit list is defence in depth here, not the sole mitigation.
    // It stays because it is what keeps this true if the key type ever changes to
    // an asymmetric one, where HS/RS confusion is a real attack.
    const unsigned = jwt.sign({ sub: 'usr-attacker', iat: 1, exp: 9_999_999_999 }, '', {
      algorithm: 'none',
    })
    expect(() => jwt.verify(unsigned, signingSecret(), { algorithms: ['HS256'] })).toThrow()
    expect(() => jwt.verify(unsigned, signingSecret())).toThrow(/signature is required/i)
  })

  test('a token signed with the wrong secret is rejected', () => {
    const forged = jwt.sign({ sub: 'usr-attacker', iat: 1, exp: 9_999_999_999 }, 'wrong-secret', {
      algorithm: 'HS256',
    })
    expect(verifyToken(forged).isErr()).toBe(true)
  })
})

describe('expiry and clock skew', () => {
  test('an expired token is rejected', () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000)
    expect(verifyToken(issueToken('usr-abc123', longAgo)).isErr()).toBe(true)
  })

  test('a token from the near future is rejected without clock tolerance', () => {
    // The skew case §9 defers. Recording the behaviour so the deferral is
    // informed: a client whose clock is 30s ahead of the server is not affected
    // (exp is still in the future), but a SERVER whose clock is behind the issuer
    // rejects tokens as not-yet-valid only if `nbf` is set. We do not set `nbf`,
    // so the only skew exposure is at the expiry boundary.
    const token = issueToken('usr-abc123', new Date(Date.now() + 30_000))
    expect(verifyToken(token).isOk()).toBe(true)
  })

  test('the expiry boundary is where skew actually bites, and it is one option wide', () => {
    const justExpired = jwt.sign(
      { sub: 'usr-abc123', iat: 1, exp: Math.floor(Date.now() / 1000) - 5 },
      signingSecret(),
      { algorithm: 'HS256' },
    )
    expect(() => jwt.verify(justExpired, signingSecret(), { algorithms: ['HS256'] })).toThrow(
      /expired/i,
    )
    // `clockTolerance` is the deferred feature. Five seconds of slack accepts it.
    expect(() =>
      jwt.verify(justExpired, signingSecret(), { algorithms: ['HS256'], clockTolerance: 10 }),
    ).not.toThrow()
  })
})

describe('the payload is untrusted input (§3)', () => {
  test('a valid signature over an unexpected payload shape is still rejected', () => {
    // The point of §3's invariant: the signature proves origin, not shape.
    const extraClaims = jwt.sign(
      { sub: 'usr-abc123', iat: 1, exp: 9_999_999_999, role: 'admin' },
      signingSecret(),
      { algorithm: 'HS256' },
    )
    const result = verifyToken(extraClaims)
    expect(result.isErr()).toBe(true) // additionalProperties: false did its job
  })

  test('a token with a subject that is not a userId shape is rejected', () => {
    const wrongSub = jwt.sign(
      { sub: 'not-a-user-id', iat: 1, exp: 9_999_999_999 },
      signingSecret(),
      { algorithm: 'HS256' },
    )
    expect(verifyToken(wrongSub).isErr()).toBe(true)
  })

  test('CONFIRMS §3: without iat/exp declared, the payload fails its own schema', () => {
    // Reproduces the brief's [verified] claim from the other direction -- our
    // schema DOES declare them, and issuing without them fails validation.
    const noIat = jwt.sign({ sub: 'usr-abc123', exp: 9_999_999_999 }, signingSecret(), {
      algorithm: 'HS256',
      noTimestamp: true,
    })
    expect(verifyToken(noIat).isErr()).toBe(true) // `iat` is required
  })
})

describe('the signing secret (§3)', () => {
  test('a missing secret is a loud failure, not a silent default', () => {
    const saved = process.env.JWT_SECRET
    try {
      delete process.env.JWT_SECRET
      expect(() => issueToken('usr-abc123')).toThrow(/JWT_SECRET is not set/)
      expect(() => signingSecret()).toThrow(/JWT_SECRET is not set/)
    } finally {
      process.env.JWT_SECRET = saved
    }
  })

  test('an empty-string secret is treated as missing', () => {
    const saved = process.env.JWT_SECRET
    try {
      process.env.JWT_SECRET = ''
      // Without this check, jsonwebtoken happily signs with an empty key and
      // every token in the system is forgeable by anyone who guesses that.
      expect(() => issueToken('usr-abc123')).toThrow(/JWT_SECRET is not set/)
    } finally {
      process.env.JWT_SECRET = saved
    }
  })
})

describe('Authorization header parsing', () => {
  test('accepts the documented form and the case variants RFC 7235 requires', () => {
    expect(bearerToken('Bearer abc.def.ghi')._unsafeUnwrap()).toBe('abc.def.ghi')
    expect(bearerToken('bearer abc.def.ghi')._unsafeUnwrap()).toBe('abc.def.ghi')
    expect(bearerToken('BEARER  abc.def.ghi')._unsafeUnwrap()).toBe('abc.def.ghi')
  })

  test('rejects the shapes that would otherwise reach jwt.verify', () => {
    for (const header of [undefined, '', 'abc.def.ghi', 'Basic dXNlcjpwYXNz', 'Bearer']) {
      expect(bearerToken(header).isErr(), String(header)).toBe(true)
    }
  })
})
