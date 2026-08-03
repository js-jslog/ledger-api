import { Ajv } from 'ajv'
import addFormatsCjs from 'ajv-formats'
import type { Express } from 'express'
import type { Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema, truncateAll } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'
import { buildApp } from '../../src/http/routes.js'
import {
  correctedTransactionResponse,
  suppliedBankAccountResponse,
  suppliedTransactionResponse,
  suppliedUserResponse,
} from './supplied-schemas.js'

const addFormats = addFormatsCjs as unknown as (typeof addFormatsCjs)['default']

/**
 * Do the responses this service actually emits satisfy the schemas in the
 * SUPPLIED specification?
 *
 * §6 sorts spec problems into "forced", "corrective" and "note, don't build".
 * This probe checks whether the third pile is really costless.
 */

const ajv = new Ajv({ strict: true, allErrors: true })
addFormats(ajv)
const validateUser = ajv.compile(suppliedUserResponse)
const validateAccount = ajv.compile(suppliedBankAccountResponse)
const validateTransaction = ajv.compile(suppliedTransactionResponse)
const validateTransactionCorrected = ajv.compile(correctedTransactionResponse)

let db: Kysely<Database>
let app: Express

const VALID_USER = {
  name: 'Test User',
  address: { line1: '1 High Street', town: 'Manchester', county: 'Greater Manchester', postcode: 'M1 1AA' },
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

async function signUp(): Promise<string> {
  await request(app).post('/v1/users').send(VALID_USER).expect(201)
  const login = await request(app)
    .post('/v1/auth/login')
    .send({ email: VALID_USER.email, password: VALID_USER.password })
    .expect(200)
  return login.body.token
}

async function openAccount(token: string): Promise<string> {
  const res = await request(app)
    .post('/v1/accounts')
    .set('authorization', `Bearer ${token}`)
    .send({ name: 'Personal Bank Account', accountType: 'personal' })
    .expect(201)
  return res.body.accountNumber
}

describe('responses conform to the supplied schemas', () => {
  test('UserResponse', async () => {
    const res = await request(app).post('/v1/users').send(VALID_USER).expect(201)
    expect(validateUser(res.body), JSON.stringify(validateUser.errors)).toBe(true)
  })

  test('BankAccountResponse', async () => {
    const token = await signUp()
    const res = await request(app)
      .post('/v1/accounts')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Personal Bank Account', accountType: 'personal' })
      .expect(201)
    expect(validateAccount(res.body), JSON.stringify(validateAccount.errors)).toBe(true)
  })
})

describe('the "note, don\'t build" pile is not costless', () => {
  test('a conformant sequence of requests produces a NON-conformant balance', async () => {
    // §6: "Note, don't build: the £10,000 balance ceiling with no defined breach
    // status."
    //
    // Nothing here is a misuse of the API. `amount` is capped at 10000 by the
    // request schema, so each deposit is individually legal. Two of them are not.
    const token = await signUp()
    const account = await openAccount(token)

    for (let i = 0; i < 2; i++) {
      await request(app)
        .post(`/v1/accounts/${account}/transactions`)
        .set('authorization', `Bearer ${token}`)
        .send({ amount: 10_000, currency: 'GBP', type: 'deposit' })
        .expect(201)
    }

    const res = await request(app)
      .get(`/v1/accounts/${account}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.balance).toBe(20_000)
    // The service now emits a 200 whose body violates the schema the spec
    // publishes for it. There is no status code defined for refusing the deposit,
    // so every available behaviour breaks something.
    expect(validateAccount(res.body)).toBe(false)
    expect(validateAccount.errors?.[0]).toMatchObject({
      keyword: 'maximum',
      instancePath: '/balance',
    })
  })

  test('the spec\'s own transaction id pattern rejects every id, including its example', async () => {
    // §6 corrective 4 identifies this as a path-parameter problem: "as a
    // path-parameter validator it 400s every real request". It is also in
    // TransactionResponse, so it makes response conformance unachievable -- there
    // is no id we could mint that satisfies it and is also unique.
    expect(validateTransaction({ ...SAMPLE_TRANSACTION, id: 'tan-123abc' })).toBe(false)
    expect(validateTransaction({ ...SAMPLE_TRANSACTION, id: 'tan-a' })).toBe(true)

    const token = await signUp()
    const account = await openAccount(token)
    const posted = await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 5, currency: 'GBP', type: 'deposit' })
      .expect(201)

    expect(validateTransaction(posted.body)).toBe(false) // against the spec as written
    expect(validateTransactionCorrected(posted.body)).toBe(true) // with §6's fix
  })

  test('a £0 transaction: the spec permits it, this service refuses it', async () => {
    // §6: "Note, don't build: `minimum: 0.00` permitting a £0 transaction."
    // Worth recording as a deliberate deviation rather than an omission, because
    // it is a 400 the spec does not sanction.
    const token = await signUp()
    const account = await openAccount(token)
    await request(app)
      .post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 0, currency: 'GBP', type: 'deposit' })
      .expect(400)
  })
})

const SAMPLE_TRANSACTION = {
  id: 'tan-a',
  amount: 10.99,
  currency: 'GBP',
  type: 'deposit',
  createdTimestamp: new Date().toISOString(),
}
