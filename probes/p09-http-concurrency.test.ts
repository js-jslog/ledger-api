// PROBE 09 — The withdrawal race through the whole stack, not just raw SQL.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { connect } from '../src/db/connect.js'
import { makeApp } from '../src/http/app.js'

const SECRET = 'probe-secret'
const db = connect('postgres://ledger:ledger@localhost:5432/ledger')
const app = makeApp(db, SECRET)
afterAll(async () => { await db.destroy() })

let token: string
let account: string

beforeEach(async () => {
  await db.deleteFrom('transactions').execute()
  await db.deleteFrom('accounts').execute()
  await db.deleteFrom('users').execute()
  await request(app).post('/v1/users').send({
    name: 'Racer',
    address: { line1: '1 Fast St', town: 'Brands Hatch', county: 'Kent', postcode: 'DA3 8NG' },
    phoneNumber: '+447700900002', email: 'racer@example.com',
    password: 'correct horse battery staple',
  }).expect(201)
  token = (await request(app).post('/v1/auth/login')
    .send({ email: 'racer@example.com', password: 'correct horse battery staple' })
    .expect(200)).body.token
  account = (await request(app).post('/v1/accounts')
    .set('authorization', `Bearer ${token}`)
    .send({ name: 'Current', accountType: 'personal' }).expect(201)).body.accountNumber
  await request(app).post(`/v1/accounts/${account}/transactions`)
    .set('authorization', `Bearer ${token}`)
    .send({ amount: 100, currency: 'GBP', type: 'deposit' }).expect(201)
})

const withdraw = (amount: number) =>
  request(app).post(`/v1/accounts/${account}/transactions`)
    .set('authorization', `Bearer ${token}`)
    .send({ amount, currency: 'GBP', type: 'withdrawal' })

const balance = async () =>
  (await request(app).get(`/v1/accounts/${account}`)
    .set('authorization', `Bearer ${token}`)).body.balance

const ledgerTotal = async () => {
  const res = await request(app).get(`/v1/accounts/${account}/transactions`)
    .set('authorization', `Bearer ${token}`)
  return (res.body.transactions as { amount: number; type: string }[]).reduce(
    (acc, t) => acc + (t.type === 'deposit' ? t.amount : -t.amount), 0,
  )
}

describe('concurrent withdrawals through the API', () => {
  it('two simultaneous 60.00 withdrawals: one 201, one 422', async () => {
    const [a, b] = await Promise.all([withdraw(60), withdraw(60)])
    expect([a.status, b.status].sort()).toEqual([201, 422])
    expect(await balance()).toBe(40)
  })

  it('20 simultaneous 10.00 withdrawals: exactly 10 succeed and the ledger reconciles', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => withdraw(10)))
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(10)
    expect(statuses.filter((s) => s === 422)).toHaveLength(10)
    expect(statuses.filter((s) => s >= 500)).toHaveLength(0)

    // The critical invariant: the stored balance equals the sum of the ledger.
    expect(await balance()).toBe(0)
    expect(await ledgerTotal()).toBe(0)
  })

  it('mixed deposits and withdrawals reconcile', async () => {
    const ops = [
      ...Array.from({ length: 10 }, () => withdraw(15)),
      ...Array.from({ length: 10 }, () =>
        request(app).post(`/v1/accounts/${account}/transactions`)
          .set('authorization', `Bearer ${token}`)
          .send({ amount: 5, currency: 'GBP', type: 'deposit' })),
    ]
    const results = await Promise.all(ops)
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0)
    expect(await balance()).toBe(await ledgerTotal())
  })

  it('POOL EXHAUSTION: concurrency above the pg pool size must not 500', async () => {
    // The pool is max: 20. Each withdrawal holds a connection for a transaction.
    // 60 simultaneous requests queue rather than fail — but they queue *forever* by
    // default: node-postgres has no acquire timeout unless one is configured, so a
    // slow query turns into hung requests rather than a fast 503.
    const results = await Promise.all(Array.from({ length: 60 }, () => withdraw(1)))
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0)
    expect(results.filter((r) => r.status === 201)).toHaveLength(60)
    expect(await balance()).toBe(40)
    expect(await ledgerTotal()).toBe(40)
  })
})
