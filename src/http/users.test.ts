import { compare } from 'bcryptjs'
import express, { type Express } from 'express'
import { okAsync } from 'neverthrow'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { truncateAll } from '../../test/db/truncate.js'
import { capturedLogs } from '../../test/observability/captured-logs.js'
import { connect, testDatabaseUrl } from '../db/connection.js'
import { correlationMiddleware } from '../observability/correlation.js'
import type { UserResponseBody, UsersService } from '../service/users.js'
import { createApp } from './app.js'
import { errorMiddleware, notFoundFallback } from './error-middleware.js'
import { createUser } from './users.js'

const db = connect(testDatabaseUrl())
const app = createApp(db)

// Silences the sink for the whole file, and hands back what was written for the one
// describe that asserts on it. Every error logs at construction, so without this the
// suite's output is buried in JSON from the sad-path tests.
const records = capturedLogs()

beforeEach(async () => {
  await truncateAll(db)
})

afterAll(async () => {
  await db.destroy()
})

/**
 * `response.body` is `any`, which the lint rules reject on member access — and rightly,
 * since an assertion against `any` can quietly stop asserting anything. Reading the text
 * back gives the same object with an honest type.
 */
const bodyOf = (response: { text: string }): Record<string, unknown> =>
  JSON.parse(response.text) as Record<string, unknown>

const signup = {
  name: 'Test User',
  address: {
    line1: '1 Test Street',
    town: 'Testville',
    county: 'Testshire',
    postcode: 'TE1 1ST',
  },
  phoneNumber: '+441234567890',
  email: 'test@example.com',
  password: 'correct horse battery staple',
}

describe('POST /v1/users', () => {
  test('creates a user and returns the published representation', async () => {
    const response = await request(app).post('/v1/users').send(signup)

    expect(response.status).toBe(201)
    expect(bodyOf(response)).toMatchObject({
      name: 'Test User',
      address: {
        line1: '1 Test Street',
        town: 'Testville',
        county: 'Testshire',
        postcode: 'TE1 1ST',
      },
      phoneNumber: '+441234567890',
      email: 'test@example.com',
    })
    expect(bodyOf(response)['id']).toMatch(/^usr-[A-Za-z0-9]+$/)
  })

  test('publishes both timestamps as date-time strings', async () => {
    const response = await request(app).post('/v1/users').send(signup)

    expect(bodyOf(response)['createdTimestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
    expect(bodyOf(response)['updatedTimestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
  })

  test('never returns the password or its hash', async () => {
    const response = await request(app).post('/v1/users').send(signup)

    expect(response.text).not.toContain(signup.password)
    expect(response.text).not.toMatch(/\$2[aby]\$/)
    expect(Object.keys(bodyOf(response)).sort()).toEqual([
      'address',
      'createdTimestamp',
      'email',
      'id',
      'name',
      'phoneNumber',
      'updatedTimestamp',
    ])
  })

  test('stores the password as a bcrypt hash and never as plaintext', async () => {
    await request(app).post('/v1/users').send(signup)

    const stored = await db
      .selectFrom('users')
      .select('password_hash')
      .executeTakeFirstOrThrow()

    expect(stored.password_hash).not.toBe(signup.password)
    expect(await compare(signup.password, stored.password_hash)).toBe(true)
  })

  test('answers 400 with the offending fields when required data is missing', async () => {
    const { email: _email, ...withoutEmail } = signup

    const response = await request(app).post('/v1/users').send(withoutEmail)

    expect(response.status).toBe(400)
    expect(bodyOf(response)['message']).toBe('Invalid request body')
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'email',
      message: "must have required property 'email'",
      type: 'required',
    })
  })

  // Not arbitrary tidiness about field lengths. Measured: bcrypt hashes the first 72
  // bytes and ignores the rest, so without this bound `'a'.repeat(100)` and
  // `'a'.repeat(72)` are the same credential. R36.
  test('refuses a password longer than bcrypt will actually hash', async () => {
    const response = await request(app)
      .post('/v1/users')
      .send({ ...signup, password: 'a'.repeat(73) })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'password',
      message: 'must NOT have more than 72 characters',
      type: 'maxLength',
    })
  })

  test('answers 409 when the email is already taken', async () => {
    await request(app).post('/v1/users').send(signup)

    const response = await request(app).post('/v1/users').send(signup)

    expect(response.status).toBe(409)
    expect(bodyOf(response)['message']).toBe('A user already exists with the supplied email address')
  })

  test('treats an email differing only in case as already taken', async () => {
    await request(app).post('/v1/users').send(signup)

    const response = await request(app)
      .post('/v1/users')
      .send({ ...signup, email: 'TEST@example.com' })

    expect(response.status).toBe(409)
  })
})

const register = async (body: object = signup): Promise<string> => {
  const response = await request(app).post('/v1/users').send(body)

  return bodyOf(response)['id'] as string
}

const tokenFor = async (body: object): Promise<string> => {
  const response = await request(app).post('/v1/auth/login').send(body)

  return bodyOf(response)['token'] as string
}

const fetchAs = (token: string, userId: string): request.Test =>
  request(app).get(`/v1/users/${userId}`).set('authorization', `Bearer ${token}`)

const other = {
  ...signup,
  name: 'Other User',
  email: 'other@example.com',
  password: 'a completely different password',
}

describe('GET /v1/users/{userId}', () => {
  test('returns the authenticated user their own details', async () => {
    const userId = await register()
    const token = await tokenFor({ email: signup.email, password: signup.password })

    const response = await fetchAs(token, userId)

    expect(response.status).toBe(200)
    expect(bodyOf(response)).toMatchObject({
      id: userId,
      name: 'Test User',
      email: 'test@example.com',
      phoneNumber: '+441234567890',
    })
  })

  test('never returns the password hash', async () => {
    const userId = await register()
    const token = await tokenFor({ email: signup.email, password: signup.password })

    const response = await fetchAs(token, userId)

    expect(response.text).not.toMatch(/\$2[aby]\$/)
    expect(Object.keys(bodyOf(response)).sort()).toEqual([
      'address',
      'createdTimestamp',
      'email',
      'id',
      'name',
      'phoneNumber',
      'updatedTimestamp',
    ])
  })

  test('answers 403 for a user id belonging to somebody else', async () => {
    const otherId = await register(other)
    await register()
    const token = await tokenFor({ email: signup.email, password: signup.password })

    const response = await fetchAs(token, otherId)

    expect(response.status).toBe(403)
    expect(bodyOf(response)['message']).toBe('You are not allowed to access this user')
  })

  /**
   * The test that tells resolve-then-authorise apart from authorise-alone. Comparing the
   * path parameter against the token without going to the database answers 403 here, which
   * looks like a stricter version of the same thing and is a departure from a written
   * scenario. Nothing else in this file fails if the order is reversed.
   */
  test('answers 404 for a well-formed user id that does not exist', async () => {
    await register()
    const token = await tokenFor({ email: signup.email, password: signup.password })

    const response = await fetchAs(token, 'usr-0123456789abcdef')

    expect(response.status).toBe(404)
    expect(bodyOf(response)['message']).toBe('User was not found')
  })

  test('answers 400 when the user id cannot be one', async () => {
    await register()
    const token = await tokenFor({ email: signup.email, password: signup.password })

    const response = await fetchAs(token, 'not-a-user-id')

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'userId',
      message: 'must match pattern "^usr-[A-Za-z0-9]+$"',
      type: 'pattern',
    })
  })

  test('answers 401 with no token, before it has an opinion about the user id', async () => {
    const response = await request(app).get('/v1/users/not-a-user-id')

    expect(response.status).toBe(401)
    expect(bodyOf(response)['message']).toBe('Authentication failed')
  })
})

/**
 * The claim section 8c makes for egress validation, tested by breaking it on purpose.
 *
 * `additionalProperties: false` on the response schema is supposed to turn section 3's
 * "no persistence entity and no password hash ever reaches a response body" from a
 * checklist item into a checked property. The service's return type already makes this
 * unrepresentable, which is why the leak below needs a cast — the question is what
 * happens to a leak that gets past the type, since that is the only kind there can be.
 */
describe('a service that leaks a persistence row', () => {
  const PASSWORD_HASH = '$2b$04$0123456789012345678901uSomeRealLookingHashValue'

  const leaking = (body: unknown): Express => {
    const app = express()

    app.use(correlationMiddleware)
    app.use(express.json())
    app.post(
      '/v1/users',
      createUser({
        signup_userRzA: () => okAsync(body as UserResponseBody),
        fetch_userRzA: () => okAsync(body as UserResponseBody),
      } satisfies UsersService),
    )
    app.use(notFoundFallback)
    app.use(errorMiddleware)

    return app
  }

  const leaked = {
    id: 'usr-0123456789abcdef',
    name: 'Test User',
    address: {
      line1: '1 Test Street',
      town: 'Testville',
      county: 'Testshire',
      postcode: 'TE1 1ST',
    },
    phoneNumber: '+441234567890',
    email: 'test@example.com',
    createdTimestamp: '2026-08-05T00:00:00.000Z',
    updatedTimestamp: '2026-08-05T00:00:00.000Z',
    password_hash: PASSWORD_HASH,
  }

  test('answers 500 rather than disclosing it', async () => {
    const response = await request(leaking(leaked)).post('/v1/users').send(signup)

    expect(response.status).toBe(500)
    expect(response.text).not.toContain(PASSWORD_HASH)
    expect(bodyOf(response)).toEqual({
      message: 'An unexpected error occurred',
      correlationId: response.headers['x-correlation-id'],
    })
  })

  test('logs the mismatch, naming the property but never its value', async () => {
    await request(leaking(leaked)).post('/v1/users').send(signup)

    const created = records().find((record) => record['event'] === 'error.created')

    expect(created?.['mismatches']).toEqual(['password_hash must NOT have additional properties'])
    expect(JSON.stringify(records())).not.toContain(PASSWORD_HASH)
  })
})
