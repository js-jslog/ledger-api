import { randomBytes } from 'node:crypto'

import express, { type Express } from 'express'
import { SignJWT } from 'jose'
import { okAsync, type ResultAsync } from 'neverthrow'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { truncateAll } from '../../test/db/truncate.js'
import { capturedLogs } from '../../test/observability/captured-logs.js'
import { connect, testDatabaseUrl } from '../db/connection.js'
import type { DomainError } from '../domain/errors.js'
import { correlationMiddleware } from '../observability/correlation.js'
import { createApp } from './app.js'
import { errorMiddleware, notFoundFallback } from './error-middleware.js'
import { authedHandler, type Success } from './handler.js'
import { tokenClaimsSchema } from './schemas.js'
import { validatorFor } from './validator-for.js'

const db = connect(testDatabaseUrl())
const app = createApp(db)

capturedLogs()

beforeEach(async () => {
  await truncateAll(db)
})

afterAll(async () => {
  await db.destroy()
})

const bodyOf = (response: { text: string }): Record<string, unknown> =>
  JSON.parse(response.text) as Record<string, unknown>

const signup = {
  name: 'Test User',
  address: { line1: '1 Test Street', town: 'Testville', county: 'Testshire', postcode: 'TE1 1ST' },
  phoneNumber: '+441234567890',
  email: 'test@example.com',
  password: 'correct horse battery staple',
}

const credentials = { email: signup.email, password: signup.password }

const register = async (): Promise<string> => {
  const response = await request(app).post('/v1/users').send(signup)

  return bodyOf(response)['id'] as string
}

const tokenFor = async (body: object): Promise<string> => {
  const response = await request(app).post('/v1/auth/login').send(body)

  return bodyOf(response)['token'] as string
}

/**
 * The first consumer of `authedHandler`, and it is a test rather than a route because no
 * authenticated route exists yet — the first one arrives with `GET /v1/users/{userId}`.
 * It echoes the identity the adapter passed, which is the only thing about the adapter a
 * caller can observe from outside.
 */
type Identity = { readonly id: string }

const identitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const

const echoing = (onCall: () => void = () => undefined): Express => {
  const echo = express()

  echo.use(correlationMiddleware)
  echo.use(express.json())
  echo.get(
    '/whoami',
    authedHandler(identitySchema, (userId): ResultAsync<Success<Identity>, DomainError> => {
      onCall()

      return okAsync({ status: 200, body: { id: userId } })
    }),
  )
  echo.use(notFoundFallback)
  echo.use(errorMiddleware)

  return echo
}

const echoIdentity = (): Express => echoing()

describe('POST /v1/auth/login', () => {
  test('exchanges valid credentials for a token, and returns nothing else', async () => {
    await register()

    const response = await request(app).post('/v1/auth/login').send(credentials)

    expect(response.status).toBe(200)
    expect(Object.keys(bodyOf(response))).toEqual(['token'])
    expect(typeof bodyOf(response)['token']).toBe('string')
  })

  test('the token names the user who authenticated', async () => {
    const userId = await register()

    const response = await request(echoIdentity())
      .get('/whoami')
      .set('authorization', `Bearer ${await tokenFor(credentials)}`)

    expect(response.status).toBe(200)
    expect(bodyOf(response)['id']).toBe(userId)
  })

  /**
   * The forward obligation of storing the address as submitted: uniqueness is an index on
   * `lower(email)`, so a lookup against the raw column locks out anyone who typed a
   * capital letter — and does it as a 401, which looks like a wrong password rather than
   * like a defect. Recorded at docs/divergences.md § Slice 2 and cashed here.
   */
  test('authenticates an email that differs from the stored one only in case', async () => {
    await register()

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ ...credentials, email: 'TEST@EXAMPLE.COM' })

    expect(response.status).toBe(200)
    expect(typeof bodyOf(response)['token']).toBe('string')
  })

  test('never returns the password or a hash', async () => {
    await register()

    const response = await request(app).post('/v1/auth/login').send(credentials)

    expect(response.text).not.toContain(credentials.password)
    expect(response.text).not.toMatch(/\$2[aby]\$/)
  })

  test('answers 400 when a credential field is missing', async () => {
    const response = await request(app).post('/v1/auth/login').send({ email: signup.email })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'password',
      message: "must have required property 'password'",
      type: 'required',
    })
  })

  /**
   * The property, rather than two tests that happen to agree: a wrong password and an
   * unknown address must be indistinguishable, or the endpoint answers "does this email
   * exist" to anyone who reads the body. Asserting they are *equal* is what keeps that
   * true when someone later improves one of the messages.
   */
  test('answers an identical 401 to a wrong password and to an unknown email', async () => {
    await register()

    const wrongPassword = await request(app)
      .post('/v1/auth/login')
      .send({ ...credentials, password: 'not the right password' })

    const unknownEmail = await request(app)
      .post('/v1/auth/login')
      .send({ ...credentials, email: 'nobody@example.com' })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(bodyOf(wrongPassword)['message']).toBe('Authentication failed')
    expect(Object.keys(bodyOf(unknownEmail)).sort()).toEqual(['correlationId', 'message'])
    expect(bodyOf(unknownEmail)['message']).toBe(bodyOf(wrongPassword)['message'])
  })

  test('never writes the supplied password to a log record', async () => {
    const records = capturedLogs()
    await register()

    await request(app)
      .post('/v1/auth/login')
      .send({ ...credentials, password: 'a password that is wrong' })

    expect(JSON.stringify(records())).not.toContain('a password that is wrong')
  })
})

describe('authedHandler', () => {
  const get = (header?: string): request.Test => {
    const pending = request(echoIdentity()).get('/whoami')

    return header === undefined ? pending : pending.set('authorization', header)
  }

  test.each([
    ['no authorization header', undefined],
    ['an empty header', ''],
    ['a scheme this API does not accept', 'Basic dXNlcjpwYXNz'],
    ['the word Bearer with no token', 'Bearer '],
    ['a token that is not a JWT at all', 'Bearer not-a-jwt'],
  ])('answers 401 to %s', async (_case, header) => {
    const response = await get(header)

    expect(response.status).toBe(401)
    expect(bodyOf(response)['message']).toBe('Authentication failed')
  })

  /**
   * A well-formed token, correctly shaped claims, valid `exp` — and a signature this
   * process did not produce. This is the forgery the design actually stands against; the
   * `alg: none` variety is refused by jose itself, measured rather than assumed — see the
   * comment on `ALGORITHM` in `src/domain/tokens.ts`.
   */
  test('answers 401 to a token signed with a different key', async () => {
    const forged = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('usr-0123456789abcdef')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(randomBytes(32))

    const response = await get(`Bearer ${forged}`)

    expect(response.status).toBe(401)
  })

  test('does not call the handler when authentication fails', async () => {
    let called = false

    await request(echoing(() => (called = true))).get('/whoami')

    expect(called).toBe(false)
  })
})

/**
 * The section 3 invariant, at the schema rather than through a token: the payload of a
 * token this process signed cannot be given the wrong shape without the signing key, so
 * the reachable half is that the schema rejects what it is supposed to reject. What the
 * round trip above covers is that `verify_tokenRzA` actually consults it.
 */
describe('the decoded JWT payload is validated as untrusted input', () => {
  const validateClaims = validatorFor(tokenClaimsSchema)

  const claims = { sub: 'usr-0123456789abcdef', iat: 1_754_000_000, exp: 1_754_003_600 }

  test('accepts the claims this service issues', () => {
    expect(validateClaims(claims).isOk()).toBe(true)
  })

  test.each(['sub', 'iat', 'exp'])('rejects a payload missing %s', (claim) => {
    const without: Record<string, unknown> = { ...claims }
    delete without[claim]

    expect(validateClaims(without).isErr()).toBe(true)
  })

  test('rejects a claim the schema does not declare', () => {
    expect(validateClaims({ ...claims, role: 'admin' }).isErr()).toBe(true)
  })
})
