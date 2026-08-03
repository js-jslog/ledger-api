import type { Express } from 'express'
import type { Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema, truncateAll } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'
import { buildApp } from '../../src/http/routes.js'

/**
 * §14's last unknown: "A single request end-to-end through Ajv, neverthrow,
 * Kysely and Express together. Each was probed alone... it is the seam most
 * likely to be quietly ugly in a walkthrough."
 *
 * Every assertion below crosses all four libraries.
 */

let db: Kysely<Database>
let app: Express

const VALID_USER = {
  name: 'Test User',
  address: {
    line1: '1 High Street',
    town: 'Manchester',
    county: 'Greater Manchester',
    postcode: 'M1 1AA',
  },
  phoneNumber: '+447700900000',
  email: 'test@example.com',
  password: 'correct-horse-battery',
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'probe-secret-not-a-real-key'
  db = createDb()
  await resetSchema(db)
  await migrateToLatest(db)
  app = buildApp(db)
})

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await truncateAll(db)
})

/** Signs a user up and logs them in, returning their id and bearer token. */
async function signUp(
  overrides: Partial<typeof VALID_USER> = {},
): Promise<{ userId: string; token: string }> {
  const body = { ...VALID_USER, ...overrides }
  const created = await request(app).post('/v1/users').send(body).expect(201)
  const login = await request(app)
    .post('/v1/auth/login')
    .send({ email: body.email, password: body.password })
    .expect(200)
  return { userId: created.body.id, token: login.body.token }
}

async function openAccount(token: string): Promise<string> {
  const res = await request(app)
    .post('/v1/accounts')
    .set('authorization', `Bearer ${token}`)
    .send({ name: 'Personal Bank Account', accountType: 'personal' })
    .expect(201)
  return res.body.accountNumber
}

describe('signup, login, and the keystone ownership check', () => {
  test('a user can be created and the response never contains the hash', async () => {
    const res = await request(app).post('/v1/users').send(VALID_USER).expect(201)
    expect(res.body.id).toMatch(/^usr-[A-Za-z0-9]+$/)
    expect(res.body).not.toHaveProperty('password')
    expect(res.body).not.toHaveProperty('password_hash')
    expect(res.body).not.toHaveProperty('passwordHash')
    // The address round-tripped through the nested schema.
    expect(res.body.address.town).toBe('Manchester')
    // Absent optional address lines are absent, not null.
    expect(res.body.address).not.toHaveProperty('line2')
  })

  test('a missing required field is a spec-shaped 400', async () => {
    const { email: _email, ...withoutEmail } = VALID_USER
    const res = await request(app).post('/v1/users').send(withoutEmail).expect(400)
    expect(res.body.message).toBeDefined()
    expect(res.body.details).toBeInstanceOf(Array)
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain('email')
  })

  test('an unknown key in the nested address is rejected (mass assignment)', async () => {
    const res = await request(app)
      .post('/v1/users')
      .send({ ...VALID_USER, address: { ...VALID_USER.address, isAdmin: true } })
      .expect(400)
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain('isAdmin')
  })

  test('a duplicate email is a 409, from the constraint (§6)', async () => {
    await request(app).post('/v1/users').send(VALID_USER).expect(201)
    const res = await request(app).post('/v1/users').send(VALID_USER).expect(409)
    expect(res.body.message).toMatch(/already exists/i)
  })

  test('login returns a token; bad credentials are indistinguishable 401s', async () => {
    await request(app).post('/v1/users').send(VALID_USER).expect(201)

    const wrongPassword = await request(app)
      .post('/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'not-the-password' })
      .expect(401)
    const unknownEmail = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' })
      .expect(401)

    // No user-enumeration oracle: identical bodies.
    expect(wrongPassword.body).toEqual(unknownEmail.body)
  })

  test('THE KEYSTONE: own user 200, other user 403, absent user 404', async () => {
    const alice = await signUp()
    const bob = await signUp({ email: 'bob@example.com' })

    await request(app)
      .get(`/v1/users/${alice.userId}`)
      .set('authorization', `Bearer ${alice.token}`)
      .expect(200)

    await request(app)
      .get(`/v1/users/${bob.userId}`)
      .set('authorization', `Bearer ${alice.token}`)
      .expect(403)

    await request(app)
      .get('/v1/users/usr-doesnotexist')
      .set('authorization', `Bearer ${alice.token}`)
      .expect(404)
  })

  test('every authenticated endpoint 401s without a usable token', async () => {
    const { userId, token } = await signUp()
    const path = `/v1/users/${userId}`

    await request(app).get(path).expect(401) // no header
    await request(app).get(path).set('authorization', token).expect(401) // no scheme
    await request(app).get(path).set('authorization', 'Bearer nonsense').expect(401)
    await request(app).get(path).set('authorization', 'Basic dXNlcjpwYXNz').expect(401)
    // ...and the valid one still works, so the above are not passing vacuously.
    await request(app).get(path).set('authorization', `Bearer ${token}`).expect(200)
  })
})

describe('accounts', () => {
  test('creation mints a spec-shaped account with a zero balance', async () => {
    const { token } = await signUp()
    const res = await request(app)
      .post('/v1/accounts')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Personal Bank Account', accountType: 'personal' })
      .expect(201)

    expect(res.body.accountNumber).toMatch(/^01\d{6}$/)
    expect(res.body.sortCode).toBe('10-10-10')
    expect(res.body.balance).toBe(0)
    expect(res.body.currency).toBe('GBP')
    expect(typeof res.body.createdTimestamp).toBe('string')
  })

  test('list is scoped to the authenticated user', async () => {
    const alice = await signUp()
    const bob = await signUp({ email: 'bob@example.com' })
    await openAccount(alice.token)
    await openAccount(alice.token)
    await openAccount(bob.token)

    const res = await request(app)
      .get('/v1/accounts')
      .set('authorization', `Bearer ${alice.token}`)
      .expect(200)
    expect(res.body.accounts).toHaveLength(2)
  })

  test("another user's account is 403, an absent one 404, a malformed one 400", async () => {
    const alice = await signUp()
    const bob = await signUp({ email: 'bob@example.com' })
    const bobAccount = await openAccount(bob.token)

    await request(app)
      .get(`/v1/accounts/${bobAccount}`)
      .set('authorization', `Bearer ${alice.token}`)
      .expect(403)
    await request(app)
      .get('/v1/accounts/01999999')
      .set('authorization', `Bearer ${alice.token}`)
      .expect(404)
    // Path-parameter validation, from the spec's own pattern.
    await request(app)
      .get('/v1/accounts/GARBAGE')
      .set('authorization', `Bearer ${alice.token}`)
      .expect(400)
  })
})

describe('transactions -- the slice that is never dropped', () => {
  test('a deposit updates the balance and is readable back', async () => {
    const { token } = await signUp()
    const account = await openAccount(token)

    const deposit = await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 10.99, currency: 'GBP', type: 'deposit', reference: 'salary' })
      .expect(201)

    expect(deposit.body.amount).toBe(10.99) // exact round trip through pennies
    expect(deposit.body.id).toMatch(/^tan-[A-Za-z0-9]+$/)

    const account_ = await request(app)
      .get(`/v1/accounts/${account}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)
    expect(account_.body.balance).toBe(10.99)
  })

  test('0.29 survives the decimal/pennies boundary (F6)', async () => {
    // The amount that multipleOf: 0.01 and Number.isInteger(x*100) both reject.
    const { token } = await signUp()
    const account = await openAccount(token)

    await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 0.29, currency: 'GBP', type: 'deposit' })
      .expect(201)

    const res = await request(app)
      .get(`/v1/accounts/${account}`)
      .set('authorization', `Bearer ${token}`)
    expect(res.body.balance).toBe(0.29)
  })

  test('more than two decimal places is a 400', async () => {
    const { token } = await signUp()
    const account = await openAccount(token)
    await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 10.999, currency: 'GBP', type: 'deposit' })
      .expect(400)
  })

  test('a withdrawal beyond the balance is 422, and the balance is untouched', async () => {
    const { token } = await signUp()
    const account = await openAccount(token)

    await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 50, currency: 'GBP', type: 'deposit' })
      .expect(201)

    const res = await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 50.01, currency: 'GBP', type: 'withdrawal' })
      .expect(422)
    expect(res.body.message).toMatch(/insufficient funds/i)

    const after = await request(app)
      .get(`/v1/accounts/${account}`)
      .set('authorization', `Bearer ${token}`)
    expect(after.body.balance).toBe(50)
  })

  test("posting to another user's account is 403, not 404", async () => {
    const alice = await signUp()
    const bob = await signUp({ email: 'bob@example.com' })
    const bobAccount = await openAccount(bob.token)

    await request(app)
      .post(`/v1/accounts/${bobAccount}/transactions`)
      .set('authorization', `Bearer ${alice.token}`)
      .send({ amount: 10, currency: 'GBP', type: 'deposit' })
      .expect(403)
  })

  test('§6 P7: a transaction fetched under the wrong account number is 404', async () => {
    const { token } = await signUp()
    const accountA = await openAccount(token)
    const accountB = await openAccount(token)

    const posted = await request(app)
      .post(`/v1/accounts/${accountA}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 5, currency: 'GBP', type: 'deposit' })
      .expect(201)

    // Both accounts belong to this user, so ownership passes for both. Only the
    // query scoping distinguishes them -- and TransactionResponse carries no
    // accountId, so a fetch-then-compare implementation has nothing to compare.
    await request(app)
      .get(`/v1/accounts/${accountA}/transactions/${posted.body.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)

    await request(app)
      .get(`/v1/accounts/${accountB}/transactions/${posted.body.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(404)
  })

  test('the transaction list is scoped and ordered', async () => {
    const { token } = await signUp()
    const account = await openAccount(token)
    for (const amount of [1, 2, 3]) {
      await request(app)
        .post(`/v1/accounts/${account}/transactions`)
        .set('authorization', `Bearer ${token}`)
        .send({ amount, currency: 'GBP', type: 'deposit' })
        .expect(201)
    }
    const res = await request(app)
      .get(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)
    expect(res.body.transactions.map((t: { amount: number }) => t.amount)).toEqual([1, 2, 3])
  })
})

describe('the two error sources meet in one renderer (§8)', () => {
  test('a domain failure and an infrastructure failure render the same envelope shape', async () => {
    const { token } = await signUp()

    // Domain: a Result error from the service layer.
    const domain = await request(app)
      .get('/v1/accounts/01999999')
      .set('authorization', `Bearer ${token}`)
      .expect(404)

    // Infrastructure: body-parser SyntaxError, never a Result.
    const infra = await request(app)
      .post('/v1/users')
      .set('content-type', 'application/json')
      .send('{"broken')
      .expect(400)

    expect(Object.keys(domain.body)).toEqual(['message'])
    expect(Object.keys(infra.body).sort()).toEqual(['details', 'message'])
    // Neither leaks a stack trace.
    expect(domain.text).not.toContain('at ')
    expect(infra.text).not.toContain('at ')
  })

  test('an unmatched route is the JSON 404 envelope, not Express HTML', async () => {
    const res = await request(app).get('/v1/nope').expect(404)
    expect(res.body.message).toBeDefined()
  })

  test('a text/plain body is a 400, not a 500 (§8 criterion 4)', async () => {
    await request(app)
      .post('/v1/users')
      .set('content-type', 'text/plain')
      .send('name=x')
      .expect(400)
  })
})
