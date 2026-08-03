// PROBE 05 — The brief's concurrency claim, tested against real Postgres.
//
// Claim: "a conditional UPDATE ... WHERE balance >= $1 inside an explicit transaction,
// correct under READ COMMITTED because Postgres re-evaluates the WHERE clause after
// the blocking transaction commits."
//
// This probe drives two genuinely concurrent connections and checks the outcome.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'

pg.types.setTypeParser(20, (v: string) => Number(v))
const CONN = 'postgres://ledger:ledger@localhost:5432/ledger'
const pool = new pg.Pool({ connectionString: CONN, max: 20 })
afterAll(async () => { await pool.end() })

const ACCT = '01000005'

beforeEach(async () => {
  await pool.query('DELETE FROM transactions')
  await pool.query('DELETE FROM accounts')
  await pool.query('DELETE FROM users')
  await pool.query(
    `INSERT INTO users (id,name,address,phone_number,email,password_hash)
     VALUES ('usr-p05','Probe','{}','+447700900000','p05@example.com','x')`,
  )
  await pool.query(
    `INSERT INTO accounts (account_number,user_id,name,account_type,balance_pence)
     VALUES ($1,'usr-p05','A','personal',10000)`, [ACCT],
  )
})

const balance = async () =>
  (await pool.query('SELECT balance_pence FROM accounts WHERE account_number=$1', [ACCT]))
    .rows[0].balance_pence

/** One withdrawal attempt: conditional UPDATE inside an explicit transaction. */
async function conditionalWithdraw(pence: number, isolation: string, holdMs = 0) {
  const c = await pool.connect()
  try {
    await c.query(`BEGIN ISOLATION LEVEL ${isolation}`)
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs))
    const res = await c.query(
      `UPDATE accounts SET balance_pence = balance_pence - $1, updated_timestamp = now()
       WHERE account_number = $2 AND balance_pence >= $1`,
      [pence, ACCT],
    )
    if (res.rowCount === 0) { await c.query('ROLLBACK'); return 'INSUFFICIENT_FUNDS' }
    await c.query('COMMIT')
    return 'OK'
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    return `ERROR:${(e as { code?: string }).code ?? (e as Error).message}`
  } finally { c.release() }
}

/** The read-modify-write shape a naive implementation reaches for first. */
async function readModifyWrite(pence: number, isolation: string, holdMs = 0) {
  const c = await pool.connect()
  try {
    await c.query(`BEGIN ISOLATION LEVEL ${isolation}`)
    const cur = (await c.query('SELECT balance_pence FROM accounts WHERE account_number=$1', [ACCT]))
      .rows[0].balance_pence
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs))
    if (cur < pence) { await c.query('ROLLBACK'); return 'INSUFFICIENT_FUNDS' }
    await c.query('UPDATE accounts SET balance_pence=$1 WHERE account_number=$2',
      [cur - pence, ACCT])
    await c.query('COMMIT')
    return 'OK'
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    return `ERROR:${(e as { code?: string }).code ?? (e as Error).message}`
  } finally { c.release() }
}

describe('two concurrent withdrawals of 60.00 against a 100.00 balance', () => {
  it("CONFIRMS the brief: conditional UPDATE under READ COMMITTED is correct", async () => {
    const results = await Promise.all([
      conditionalWithdraw(6000, 'READ COMMITTED'),
      conditionalWithdraw(6000, 'READ COMMITTED'),
    ])
    expect(results.filter((r) => r === 'OK')).toHaveLength(1)
    expect(results.filter((r) => r === 'INSUFFICIENT_FUNDS')).toHaveLength(1)
    expect(await balance()).toBe(4000) // exactly one withdrawal applied
  })

  it('and holds under contention from 10 concurrent attempts', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => conditionalWithdraw(3000, 'READ COMMITTED')),
    )
    expect(results.filter((r) => r === 'OK')).toHaveLength(3) // 3 x 30.00 = 90.00
    expect(await balance()).toBe(1000)
    expect(results.every((r) => r === 'OK' || r === 'INSUFFICIENT_FUNDS')).toBe(true)
  })

  it('CONFIRMS the caveat: read-modify-write in app code overdraws', async () => {
    const results = await Promise.all([
      readModifyWrite(6000, 'READ COMMITTED', 100),
      readModifyWrite(6000, 'READ COMMITTED', 100),
    ])
    expect(results).toEqual(['OK', 'OK']) // both believed they had funds
    // Lost update: the second write clobbers the first. Balance is 4000, not -2000,
    // and the CHECK constraint never fires, so nothing surfaces the loss.
    expect(await balance()).toBe(4000)
    // 120.00 withdrawn from a 100.00 account, yet the balance looks plausible.
  })

  it('CONFIRMS the caveat: REPEATABLE READ needs retry logic', async () => {
    // Note: a REPEATABLE READ snapshot is taken at the first *statement*, not at
    // BEGIN. Both transactions must read before either writes, or the second one
    // simply gets a fresh snapshot and no conflict occurs. Sequencing explicitly
    // rather than with sleeps.
    const a = await pool.connect()
    const b = await pool.connect()
    try {
      await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      // Both take their snapshot here, seeing balance 10000.
      await a.query('SELECT balance_pence FROM accounts WHERE account_number=$1', [ACCT])
      await b.query('SELECT balance_pence FROM accounts WHERE account_number=$1', [ACCT])

      await a.query(
        `UPDATE accounts SET balance_pence = balance_pence - 6000
         WHERE account_number=$1 AND balance_pence >= 6000`, [ACCT],
      )
      const bUpdate = b.query(
        `UPDATE accounts SET balance_pence = balance_pence - 6000
         WHERE account_number=$1 AND balance_pence >= 6000`, [ACCT],
      )
      await a.query('COMMIT')

      // 40001 = serialization_failure. Without a retry loop this is a 500.
      await expect(bUpdate).rejects.toMatchObject({ code: '40001' })
      await b.query('ROLLBACK')
    } finally {
      a.release()
      b.release()
    }
    expect(await balance()).toBe(4000)
  })
})
