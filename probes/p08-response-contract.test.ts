// PROBE 08 — Validate responses against the spec's own schemas.
//
// Nothing in the brief's plan checks that responses satisfy the supplied contract.
// This probe wires up that check and asks what it catches.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Ajv } from 'ajv'
import addFormatsModule from 'ajv-formats'
import { connect } from '../src/db/connect.js'
import { makeApp } from '../src/http/app.js'

const addFormats = addFormatsModule as unknown as (a: Ajv) => Ajv
const ajv = addFormats(new Ajv({ strict: true, allErrors: true }))

/** BankAccountResponse, transcribed from the spec with `format` -> `pattern`. */
const bankAccountResponse = {
  type: 'object',
  required: ['accountNumber', 'sortCode', 'name', 'accountType', 'balance', 'currency',
    'createdTimestamp', 'updatedTimestamp'],
  properties: {
    accountNumber: { type: 'string', pattern: '^01\\d{6}$' },
    sortCode: { type: 'string', enum: ['10-10-10'] },
    name: { type: 'string' },
    accountType: { type: 'string', enum: ['personal'] },
    // Verbatim from the spec, including the ceiling.
    balance: { type: 'number', minimum: 0, maximum: 10000 },
    currency: { type: 'string', enum: ['GBP'] },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
} as const
const validateAccount = ajv.compile(bankAccountResponse)

const SECRET = 'probe-secret'
const db = connect('postgres://ledger:ledger@localhost:5432/ledger')
const app = makeApp(db, SECRET)
afterAll(async () => { await db.destroy() })

let token: string
let account: string

beforeAll(async () => {
  await db.deleteFrom('transactions').execute()
  await db.deleteFrom('accounts').execute()
  await db.deleteFrom('users').execute()
  await request(app).post('/v1/users').send({
    name: 'Rich Person',
    address: { line1: '1 Bank St', town: 'London', county: 'Greater London', postcode: 'E14 5AA' },
    phoneNumber: '+447700900001', email: 'rich@example.com',
    password: 'correct horse battery staple',
  }).expect(201)
  const login = await request(app).post('/v1/auth/login')
    .send({ email: 'rich@example.com', password: 'correct horse battery staple' }).expect(200)
  token = login.body.token
  const acct = await request(app).post('/v1/accounts')
    .set('authorization', `Bearer ${token}`)
    .send({ name: 'Current', accountType: 'personal' }).expect(201)
  account = acct.body.accountNumber
})

const deposit = (amount: number) =>
  request(app).post(`/v1/accounts/${account}/transactions`)
    .set('authorization', `Bearer ${token}`)
    .send({ amount, currency: 'GBP', type: 'deposit' })

describe('responses against the supplied BankAccountResponse schema', () => {
  it('a fresh account satisfies the contract', async () => {
    const res = await request(app).get(`/v1/accounts/${account}`)
      .set('authorization', `Bearer ${token}`).expect(200)
    expect(validateAccount(res.body)).toBe(true)
  })

  it("SPEC CONTRADICTION: two legal deposits produce a response the spec forbids", async () => {
    // Each deposit is within CreateTransactionRequest's maximum of 10000.
    await deposit(10000).expect(201)
    await deposit(10000).expect(201)

    const res = await request(app).get(`/v1/accounts/${account}`)
      .set('authorization', `Bearer ${token}`).expect(200)
    expect(res.body.balance).toBe(20000)

    // ...and the response now violates BankAccountResponse.balance maximum: 10000.
    expect(validateAccount(res.body)).toBe(false)
    expect(validateAccount.errors?.[0]?.keyword).toBe('maximum')

    // There is no status code in the spec for "this deposit would exceed the balance
    // ceiling". The options are: treat 10000 as a real business rule and invent a 422
    // (deviates from the scenarios, which say a deposit always succeeds), or treat the
    // maximum as documentation-only and knowingly emit non-conforming responses.
    // Either way it is a decision, and the brief does not currently record it.
  })
})

describe('the amount ceiling interacts badly with withdrawals too', () => {
  it('a balance above 10000 cannot be withdrawn in one transaction', async () => {
    const res = await request(app).post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .send({ amount: 20000, currency: 'GBP', type: 'withdrawal' })
    expect(res.status).toBe(400) // amount > maximum
    // So a customer can be *put into* a state they cannot exit in one operation.
  })

  it('and a sub-penny amount is a 400 from the domain, not a silent rounding', async () => {
    const res = await deposit(10.999)
    expect(res.status).toBe(400)
    expect(res.body.details[0].type).toBe('pennyPrecision')
  })

  it('DANGER: over-precise JSON is rounded by the parser before validation', async () => {
    // JSON.parse('10.9999999999999999999') === 11, so this is accepted as 11 pounds
    // and no validator anywhere can see the original digits.
    const res = await request(app).post(`/v1/accounts/${account}/transactions`)
      .set('authorization', `Bearer ${token}`)
      .set('content-type', 'application/json')
      .send('{"amount":0.9999999999999999999,"currency":"GBP","type":"deposit"}')
    expect(res.status).toBe(201)
    expect(res.body.amount).toBe(1) // asked for ~0.99, charged 1.00
  })
})
