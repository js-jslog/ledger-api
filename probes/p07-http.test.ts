// PROBE 07 — The slice driven over real HTTP, probing the spec's own contradictions.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { connect } from '../src/db/connect.js'
import { makeApp } from '../src/http/app.ts'

const SECRET = 'probe-secret'
const db = connect('postgres://ledger:ledger@localhost:5432/ledger')
const app = makeApp(db, SECRET)

afterAll(async () => { await db.destroy() })

const validUser = (email: string) => ({
  name: 'Test User',
  address: { line1: '1 High St', town: 'Reading', county: 'Berkshire', postcode: 'RG1 1AA' },
  phoneNumber: '+447700900000',
  email,
  password: 'correct horse battery staple',
})

let alice: { id: string; token: string }
let bob: { id: string; token: string }
let aliceAccount: string

const signUp = async (email: string) => {
  const created = await request(app).post('/v1/users').send(validUser(email)).expect(201)
  const login = await request(app).post('/v1/auth/login')
    .send({ email, password: validUser(email).password }).expect(200)
  return { id: created.body.id as string, token: login.body.token as string }
}

beforeAll(async () => {
  await db.deleteFrom('transactions').execute()
  await db.deleteFrom('accounts').execute()
  await db.deleteFrom('users').execute()
  alice = await signUp('alice@example.com')
  bob = await signUp('bob@example.com')
  const acct = await request(app).post('/v1/accounts')
    .set('authorization', `Bearer ${alice.token}`)
    .send({ name: 'Alice Current', accountType: 'personal' }).expect(201)
  aliceAccount = acct.body.accountNumber
})

describe('the happy path works end to end', () => {
  it('creates, authenticates, opens an account and deposits', async () => {
    expect(aliceAccount).toMatch(/^01\d{6}$/)
    const dep = await request(app).post(`/v1/accounts/${aliceAccount}/transactions`)
      .set('authorization', `Bearer ${alice.token}`)
      .send({ amount: 10.99, currency: 'GBP', type: 'deposit' }).expect(201)
    expect(dep.body.amount).toBe(10.99)
    const acct = await request(app).get(`/v1/accounts/${aliceAccount}`)
      .set('authorization', `Bearer ${alice.token}`).expect(200)
    expect(acct.body.balance).toBe(10.99)
    expect(acct.body.sortCode).toBe('10-10-10')
  })
})

describe('the spec forces a user-enumeration oracle', () => {
  it("another user's real id is 403, a fabricated id is 404", async () => {
    const other = await request(app).get(`/v1/users/${bob.id}`)
      .set('authorization', `Bearer ${alice.token}`)
    expect(other.status).toBe(403)

    const fake = await request(app).get('/v1/users/usr-000000000000')
      .set('authorization', `Bearer ${alice.token}`)
    expect(fake.status).toBe(404)
    // Alice can now test any userId for existence. The scenarios mandate exactly
    // this pairing, so it cannot be fixed without deviating; it must be *recorded*.
  })

  it('and the same oracle exists for account numbers, over a 10^6 space', async () => {
    const other = await request(app).get(`/v1/accounts/${aliceAccount}`)
      .set('authorization', `Bearer ${bob.token}`)
    expect(other.status).toBe(403) // Bob learns Alice's account number is real
    const fake = await request(app).get('/v1/accounts/01999999')
      .set('authorization', `Bearer ${bob.token}`)
    expect(fake.status).toBe(404)
    // The address space is only 1,000,000 wide and enumerable at ~403-vs-404.
  })
})

describe('authentication edge cases', () => {
  it('missing and malformed bearer tokens are 401, not 500', async () => {
    await request(app).get(`/v1/users/${alice.id}`).expect(401)
    await request(app).get(`/v1/users/${alice.id}`)
      .set('authorization', 'Bearer not-a-jwt').expect(401)
    await request(app).get(`/v1/users/${alice.id}`)
      .set('authorization', alice.token).expect(401) // no "Bearer " prefix
  })

  it('a token signed with the wrong secret is 401', async () => {
    const forged = jwt.sign({ sub: alice.id }, 'wrong-secret', { expiresIn: '1h' })
    await request(app).get(`/v1/users/${alice.id}`)
      .set('authorization', `Bearer ${forged}`).expect(401)
  })

  it('CRITICAL: an alg:none token must not authenticate', async () => {
    // The classic JWT attack. jsonwebtoken only resists it because `algorithms`
    // is pinned in verify(); without that option this test passes the attacker in.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: alice.id })).toString('base64url')
    await request(app).get(`/v1/users/${alice.id}`)
      .set('authorization', `Bearer ${header}.${payload}.`).expect(401)
  })

  it("BREAKS the brief: rejecting unknown keys on the JWT payload rejects our own tokens", async () => {
    // The brief says schemas at every boundary must reject unknown keys, "including
    // the decoded JWT payload". jsonwebtoken adds registered claims, so that schema
    // rejects every token the service itself issues.
    const decoded = jwt.verify(alice.token, SECRET) as Record<string, unknown>
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'sub'])
    // `additionalProperties: false` with only `sub` declared -> iat and exp are
    // "unknown keys" -> every request 401s.
  })
})

describe('mass assignment', () => {
  it('extra body keys are rejected, not silently stripped', async () => {
    const res = await request(app).post('/v1/accounts')
      .set('authorization', `Bearer ${alice.token}`)
      .send({ name: 'Sneaky', accountType: 'personal', balance: 1_000_000 })
    expect(res.status).toBe(400)
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain('balance')
  })

  it('and a __proto__ key in the body cannot reach the entity', async () => {
    const res = await request(app).post('/v1/accounts')
      .set('authorization', `Bearer ${alice.token}`)
      .send(JSON.parse('{"name":"P","accountType":"personal","__proto__":{"polluted":true}}'))
    // JSON.parse puts __proto__ on the object as a real own property... or does it?
    expect(res.status).toBe(201)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('malformed and oversized requests', () => {
  it('invalid JSON is a 400 with the spec error shape, not a 500', async () => {
    const res = await request(app).post('/v1/users')
      .set('content-type', 'application/json').send('{"name": ')
    expect(res.status).toBe(400)
    expect(res.body.message).toBeTypeOf('string')
  })

  it('GAP: a request with no content-type is treated as an empty body', async () => {
    const res = await request(app).post('/v1/users').send()
    expect(res.status).toBe(400) // 400 is right, but by accident of an empty body
    expect(res.body.details.length).toBeGreaterThan(0)
  })
})

describe('deferred endpoints', () => {
  it('answer 501 rather than pretending not to exist', async () => {
    await request(app).delete(`/v1/users/${alice.id}`)
      .set('authorization', `Bearer ${alice.token}`).expect(501)
    // But note: 501 is not in the supplied spec's response list for this operation.
  })
})
