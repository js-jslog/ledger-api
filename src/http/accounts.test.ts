import request from 'supertest'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { truncateAll } from '../../test/db/truncate.js'
import { capturedLogs } from '../../test/observability/captured-logs.js'
import { connect, testDatabaseUrl } from '../db/connection.js'
import type { Pennies } from '../domain/money.js'
import { createApp } from './app.js'

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

const other = { ...signup, email: 'other@example.com', password: 'a different password entirely' }

const openAccount = { name: 'Personal Bank Account', accountType: 'personal' }

/** Signs a user up and logs them in, since every route below needs a token. */
const tokenFor = async (credentials: typeof signup): Promise<string> => {
  await request(app).post('/v1/users').send(credentials)

  const response = await request(app)
    .post('/v1/auth/login')
    .send({ email: credentials.email, password: credentials.password })

  return bodyOf(response)['token'] as string
}

const open = (token: string, body: object = openAccount): request.Test =>
  request(app).post('/v1/accounts').set('authorization', `Bearer ${token}`).send(body)

const fetch = (token: string, accountNumber: string): request.Test =>
  request(app).get(`/v1/accounts/${accountNumber}`).set('authorization', `Bearer ${token}`)

describe('POST /v1/accounts', () => {
  test('opens an account and returns the published representation', async () => {
    const token = await tokenFor(signup)

    const response = await open(token)

    expect(response.status).toBe(201)
    expect(bodyOf(response)).toMatchObject({
      name: 'Personal Bank Account',
      accountType: 'personal',
      sortCode: '10-10-10',
      currency: 'GBP',
      balance: 0,
    })
    expect(bodyOf(response)['accountNumber']).toMatch(/^01\d{6}$/)
  })

  /**
   * The opening balance is a number rather than the string a `numeric` column would have
   * produced, and it is zero rather than the integer count of pennies the column holds.
   * Both are conversions nothing else in this file would notice.
   */
  test('opens with a zero balance rendered as a number', async () => {
    const token = await tokenFor(signup)

    const response = await open(token)

    expect(typeof bodyOf(response)['balance']).toBe('number')
    expect(response.text).toContain('"balance":0')
  })

  test('never exposes the owner', async () => {
    const token = await tokenFor(signup)

    const response = await open(token)

    expect(Object.keys(bodyOf(response)).sort()).toEqual([
      'accountNumber',
      'accountType',
      'balance',
      'createdTimestamp',
      'currency',
      'name',
      'sortCode',
      'updatedTimestamp',
    ])
  })

  test('gives two accounts for one user different numbers', async () => {
    const token = await tokenFor(signup)

    const first = await open(token)
    const second = await open(token, { ...openAccount, name: 'Second Account' })

    expect(bodyOf(second)['accountNumber']).not.toBe(bodyOf(first)['accountNumber'])
  })

  test('answers 400 when required data is missing', async () => {
    const token = await tokenFor(signup)

    const response = await open(token, { name: 'Personal Bank Account' })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'accountType',
      message: "must have required property 'accountType'",
      type: 'required',
    })
  })

  /**
   * Mass assignment, and the field chosen is the one that would matter: an opening balance
   * the caller picked. `additionalProperties: false` is what refuses it, and without that
   * keyword the property would be silently ignored rather than rejected — which is the same
   * outcome today and a very different one the moment the service reads the field.
   */
  test('refuses an opening balance supplied by the caller', async () => {
    const token = await tokenFor(signup)

    const response = await open(token, { ...openAccount, balance: 1000 })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'balance',
      message: 'must NOT have additional properties',
      type: 'additionalProperties',
    })
  })

  test('answers 400 to an account type the specification does not publish', async () => {
    const token = await tokenFor(signup)

    const response = await open(token, { ...openAccount, accountType: 'offshore' })

    expect(response.status).toBe(400)
  })
})

describe('GET /v1/accounts/{accountNumber}', () => {
  test('returns an account to the user who owns it', async () => {
    const token = await tokenFor(signup)
    const accountNumber = bodyOf(await open(token))['accountNumber'] as string

    const response = await fetch(token, accountNumber)

    expect(response.status).toBe(200)
    expect(bodyOf(response)).toMatchObject({ accountNumber, name: 'Personal Bank Account' })
  })

  test('answers 403 for an account belonging to somebody else', async () => {
    const owner = await tokenFor(other)
    const accountNumber = bodyOf(await open(owner))['accountNumber'] as string
    const intruder = await tokenFor(signup)

    const response = await fetch(intruder, accountNumber)

    expect(response.status).toBe(403)
    expect(bodyOf(response)['message']).toBe('You are not allowed to access this bank account')
  })

  /**
   * The case that separates resolve-then-authorise from a `where user_id = …` in the query.
   * Filtering the lookup by owner makes a foreign account indistinguishable from an absent
   * one, so this test and the one above it are the pair that pins the order.
   */
  test('answers 404 for a well-formed account number that does not exist', async () => {
    const token = await tokenFor(signup)

    const response = await fetch(token, '01999999')

    expect(response.status).toBe(404)
    expect(bodyOf(response)['message']).toBe('Bank account was not found')
  })

  /**
   * The only test that distinguishes pennies from pounds, and it needs the balance set
   * behind the API because nothing can move money until the transaction endpoints exist.
   *
   * Worth its awkwardness: the response schema cannot catch this — `type: 'number'` accepts
   * `1099` as happily as `10.99` — so without an assertion on a non-zero balance, dropping
   * `toDecimal` from the service passes every other test in this file, including the
   * zero-balance one, which is the same number in both units.
   */
  test('renders a balance in pounds rather than in the pennies it is stored as', async () => {
    const token = await tokenFor(signup)
    const accountNumber = bodyOf(await open(token))['accountNumber'] as string

    await db
      .updateTable('accounts')
      .set({ balance: 1099 as Pennies })
      .where('account_number', '=', accountNumber)
      .execute()

    const response = await fetch(token, accountNumber)

    expect(bodyOf(response)['balance']).toBe(10.99)
    expect(response.text).toContain('"balance":10.99')
  })

  test('answers 400 for an account number that cannot be one', async () => {
    const token = await tokenFor(signup)

    const response = await fetch(token, '99')

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'accountNumber',
      message: 'must match pattern "^01\\d{6}$"',
      type: 'pattern',
    })
  })
})

/**
 * The retry loop in `src/repo/accounts.ts` matches a unique violation by constraint NAME,
 * so a renamed or restructured primary key would stop it retrying — silently, since the
 * fallback is to report the collision as an internal error. Nothing in the suite can force
 * a collision, because the number is minted inside the repository with no seam to control
 * it, so what is pinned instead is the fact the matcher depends on.
 */
describe('the collision the retry loop is for', () => {
  test('a duplicate account number violates a constraint of the expected name', async () => {
    const token = await tokenFor(signup)
    const accountNumber = bodyOf(await open(token))['accountNumber'] as string
    const owner = await db
      .selectFrom('accounts')
      .select('user_id')
      .where('account_number', '=', accountNumber)
      .executeTakeFirstOrThrow()

    const cause: unknown = await db
      .insertInto('accounts')
      .values({
        account_number: accountNumber,
        user_id: owner.user_id,
        name: 'Colliding Account',
        account_type: 'personal',
      })
      .execute()
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(cause).toMatchObject({ code: '23505', constraint: 'accounts_pkey' })
  })
})
