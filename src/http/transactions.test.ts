import request from 'supertest'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { truncateAll } from '../../test/db/truncate.js'
import { capturedLogs } from '../../test/observability/captured-logs.js'
import { connect, testDatabaseUrl } from '../db/connection.js'
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

const deposit = { amount: 10.99, currency: 'GBP', type: 'deposit' }

const tokenFor = async (credentials: typeof signup): Promise<string> => {
  await request(app).post('/v1/users').send(credentials)

  const response = await request(app)
    .post('/v1/auth/login')
    .send({ email: credentials.email, password: credentials.password })

  return bodyOf(response)['token'] as string
}

const openAccount = async (token: string): Promise<string> => {
  const response = await request(app)
    .post('/v1/accounts')
    .set('authorization', `Bearer ${token}`)
    .send({ name: 'Personal Bank Account', accountType: 'personal' })

  return bodyOf(response)['accountNumber'] as string
}

const transact = (token: string, accountNumber: string, body: object): request.Test =>
  request(app)
    .post(`/v1/accounts/${accountNumber}/transactions`)
    .set('authorization', `Bearer ${token}`)
    .send(body)

const fetch = (token: string, accountNumber: string, transactionId: string): request.Test =>
  request(app)
    .get(`/v1/accounts/${accountNumber}/transactions/${transactionId}`)
    .set('authorization', `Bearer ${token}`)

const balanceOf = async (token: string, accountNumber: string): Promise<unknown> =>
  bodyOf(
    await request(app)
      .get(`/v1/accounts/${accountNumber}`)
      .set('authorization', `Bearer ${token}`),
  )['balance']

const pounds = (amount: number, type: 'deposit' | 'withdrawal'): object => ({
  amount,
  currency: 'GBP',
  type,
})

describe('POST /v1/accounts/{accountNumber}/transactions', () => {
  test('registers a deposit and updates the balance', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, deposit)

    expect(response.status).toBe(201)
    expect(bodyOf(response)).toMatchObject({ amount: 10.99, currency: 'GBP', type: 'deposit' })
    expect(await balanceOf(token, accountNumber)).toBe(10.99)
  })

  /**
   * The conversion neither schema can catch, at both ends of the same request. `type: 'number'`
   * accepts `1099` as readily as `10.99`, so an amount that skipped `toDecimal` on the way out
   * — or a balance that did — validates and reaches the client a hundredfold too large. The
   * assertion is on the serialised text as well as the parsed value, because that is what a
   * client receives.
   */
  test('renders the amount in pounds rather than the pennies it is stored as', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, deposit)

    expect(response.text).toContain('"amount":10.99')
  })

  test('registers a withdrawal against sufficient funds and updates the balance', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    await transact(token, accountNumber, pounds(100, 'deposit'))

    const response = await transact(token, accountNumber, pounds(30.5, 'withdrawal'))

    expect(response.status).toBe(201)
    expect(bodyOf(response)).toMatchObject({ amount: 30.5, type: 'withdrawal' })
    expect(await balanceOf(token, accountNumber)).toBe(69.5)
  })

  test('answers 422 to a withdrawal the balance cannot cover, and moves nothing', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    await transact(token, accountNumber, pounds(50, 'deposit'))

    const response = await transact(token, accountNumber, pounds(100, 'withdrawal'))

    expect(response.status).toBe(422)
    expect(bodyOf(response)['message']).toBe('Insufficient funds to process transaction')
    expect(await balanceOf(token, accountNumber)).toBe(50)
  })

  /**
   * The insert and the balance change are one database transaction, so a refused withdrawal
   * leaves no ledger row behind. Asserting the balance alone would pass with an orphaned row
   * in the table.
   */
  test('records no transaction for a withdrawal it refused', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    await transact(token, accountNumber, pounds(50, 'deposit'))

    await transact(token, accountNumber, pounds(100, 'withdrawal'))

    const rows = await db
      .selectFrom('transactions')
      .selectAll()
      .where('account_number', '=', accountNumber)
      .execute()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'deposit' })
  })

  test('answers 403 for an account belonging to somebody else', async () => {
    const owner = await tokenFor(other)
    const accountNumber = await openAccount(owner)
    const intruder = await tokenFor(signup)

    const response = await transact(intruder, accountNumber, deposit)

    expect(response.status).toBe(403)
    expect(bodyOf(response)['message']).toBe('You are not allowed to access this bank account')
  })

  test('answers 404 for a well-formed account number that does not exist', async () => {
    const token = await tokenFor(signup)

    const response = await transact(token, '01999999', deposit)

    expect(response.status).toBe(404)
    expect(bodyOf(response)['message']).toBe('Bank account was not found')
  })

  test('answers 400 when required data is missing', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, { amount: 10.99, currency: 'GBP' })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'type',
      message: "must have required property 'type'",
      type: 'required',
    })
  })

  /**
   * The `currencyScale` keyword, which is the ingress half of the two-decimal-place rule.
   * `toPennies` is the other half and would refuse the same amount, but only after the
   * request had been authorised — this is what makes it a 400 naming the field.
   */
  test('answers 400 to an amount with more than two decimal places', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, { ...deposit, amount: 10.999 })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'amount',
      message: 'must pass "currencyScale" keyword validation',
      type: 'currencyScale',
    })
  })

  test('answers 400 to a transaction type the specification does not publish', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, { ...deposit, type: 'transfer' })

    expect(response.status).toBe(400)
  })

  test('refuses an id supplied by the caller', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, { ...deposit, id: 'tan-chosen' })

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'id',
      message: 'must NOT have additional properties',
      type: 'additionalProperties',
    })
  })

  /**
   * `reference` is the only optional field the client may send, and the absent case is the one
   * with a trap in it: the column is nullable, and a `null` on the wire fails the published
   * `type: 'string'`. The key has to be missing rather than empty.
   */
  test('publishes a reference when given one and omits the key when not', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const withReference = await transact(token, accountNumber, {
      ...deposit,
      reference: 'Rent, June',
    })
    const without = await transact(token, accountNumber, deposit)

    expect(bodyOf(withReference)['reference']).toBe('Rent, June')
    expect(bodyOf(without)).not.toHaveProperty('reference')
  })

  /**
   * The published body, and the absence is as much the point as the presence: there is no
   * `updatedTimestamp` because there is no column for one, which is the append-only guarantee
   * as a client sees it.
   */
  test('publishes exactly the fields the specification names', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await transact(token, accountNumber, { ...deposit, reference: 'Rent, June' })

    expect(Object.keys(bodyOf(response)).sort()).toEqual([
      'amount',
      'createdTimestamp',
      'currency',
      'id',
      'reference',
      'type',
      'userId',
    ])
    expect(bodyOf(response)['id']).toMatch(/^tan-[A-Za-z0-9]+$/)
  })
})

describe('GET /v1/accounts/{accountNumber}/transactions/{transactionId}', () => {
  test('returns a transaction to the user who owns the account', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    const created = bodyOf(await transact(token, accountNumber, deposit))

    const response = await fetch(token, accountNumber, created['id'] as string)

    expect(response.status).toBe(200)
    expect(bodyOf(response)).toEqual(created)
  })

  test('answers 403 for a transaction on an account belonging to somebody else', async () => {
    const owner = await tokenFor(other)
    const accountNumber = await openAccount(owner)
    const created = bodyOf(await transact(owner, accountNumber, deposit))
    const intruder = await tokenFor(signup)

    const response = await fetch(intruder, accountNumber, created['id'] as string)

    expect(response.status).toBe(403)
  })

  test('answers 404 for a well-formed account number that does not exist', async () => {
    const token = await tokenFor(signup)

    const response = await fetch(token, '01999999', 'tan-0123456789abcdef')

    expect(response.status).toBe(404)
    expect(bodyOf(response)['message']).toBe('Bank account was not found')
  })

  /**
   * The pair of lookups in the service happens in an order, and this is the only case in
   * which the order shows: a foreign account and a transaction id that exists nowhere. Asking
   * for the transaction first answers "not found", which is true and is the wrong answer —
   * the caller is not entitled to know anything about this account, including that one of its
   * transactions is missing. Resolving and authorising the account first is what makes it a
   * 403, and without this test the two orderings are indistinguishable.
   */
  test('answers 403 rather than 404 for a missing transaction on a foreign account', async () => {
    const owner = await tokenFor(other)
    const accountNumber = await openAccount(owner)
    const intruder = await tokenFor(signup)

    const response = await fetch(intruder, accountNumber, 'tan-0123456789abcdef')

    expect(response.status).toBe(403)
  })

  test('answers 404 for a transaction id that does not exist', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await fetch(token, accountNumber, 'tan-0123456789abcdef')

    expect(response.status).toBe(404)
    expect(bodyOf(response)['message']).toBe('Transaction was not found')
  })

  /**
   * The scenario nothing else in this file would remind you of: the transaction exists, the
   * caller owns both accounts, and the answer is still 404 because it is not this account's
   * transaction. A lookup by id alone would return it, and every other test here would pass.
   */
  test('answers 404 for a transaction belonging to another of the caller’s own accounts', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    const otherAccountNumber = await openAccount(token)
    const created = bodyOf(await transact(token, otherAccountNumber, deposit))

    const response = await fetch(token, accountNumber, created['id'] as string)

    expect(response.status).toBe(404)
    expect(bodyOf(response)['message']).toBe('Transaction was not found')
  })

  test('answers 400 for a transaction id that cannot be one', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)

    const response = await fetch(token, accountNumber, 'not-a-transaction-id')

    expect(response.status).toBe(400)
    expect(bodyOf(response)['details']).toContainEqual({
      field: 'transactionId',
      message: 'must match pattern "^tan-[A-Za-z0-9]+$"',
      type: 'pattern',
    })
  })
})

/**
 * THE CONCURRENCY TEST, and it is a correctness test rather than a performance one — which is
 * why it is here rather than on a list of things to drop under time pressure. The withdrawal
 * takes no lock and no explicit isolation level, and the argument that this is safe is a
 * claim about what Postgres does under READ COMMITTED: a second `UPDATE` on the same row
 * blocks on the first's row lock and, when the first commits, re-evaluates its `WHERE` clause
 * against the committed balance rather than proceeding from its own stale snapshot. So the
 * outcome is settled by the database rather than by which request happens to arrive first.
 *
 * These two cases are the whole of R15's basis. Without them that entry says the behaviour is
 * asserted by test and nothing asserts it.
 */
describe('concurrent withdrawals against one account', () => {
  test('two £100 withdrawals against £100 yield one success, one 422 and one row', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    await transact(token, accountNumber, pounds(100, 'deposit'))

    const responses = await Promise.all([
      transact(token, accountNumber, pounds(100, 'withdrawal')),
      transact(token, accountNumber, pounds(100, 'withdrawal')),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 422])
    expect(await balanceOf(token, accountNumber)).toBe(0)

    const withdrawals = await db
      .selectFrom('transactions')
      .selectAll()
      .where('account_number', '=', accountNumber)
      .where('type', '=', 'withdrawal')
      .execute()

    expect(withdrawals).toHaveLength(1)
  })

  test('twenty concurrent £10 withdrawals against £100 yield exactly ten', async () => {
    const token = await tokenFor(signup)
    const accountNumber = await openAccount(token)
    await transact(token, accountNumber, pounds(100, 'deposit'))

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => transact(token, accountNumber, pounds(10, 'withdrawal'))),
    )

    const created = responses.filter((response) => response.status === 201)

    expect(created).toHaveLength(10)
    expect(await balanceOf(token, accountNumber)).toBe(0)
  })
})
