// PROBE 10 — The pair-coding extension the brief rates most likely after
// idempotency: transfers between accounts. It introduces a two-row transaction,
// and with it a deadlock that the single-account withdrawal path cannot have.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'

pg.types.setTypeParser(20, (v: string) => Number(v))
const pool = new pg.Pool({
  connectionString: 'postgres://ledger:ledger@localhost:5432/ledger', max: 10,
})
afterAll(async () => { await pool.end() })

const A = '01000010'
const B = '01000011'

beforeEach(async () => {
  await pool.query('DELETE FROM transactions')
  await pool.query('DELETE FROM accounts')
  await pool.query('DELETE FROM users')
  await pool.query(`INSERT INTO users (id,name,address,phone_number,email,password_hash)
    VALUES ('usr-p10','P','{}','+447700900010','p10@example.com','x')`)
  for (const acct of [A, B]) {
    await pool.query(
      `INSERT INTO accounts (account_number,user_id,name,account_type,balance_pence)
       VALUES ($1,'usr-p10','X','personal',10000)`, [acct],
    )
  }
})

const balances = async () => {
  const { rows } = await pool.query(
    'SELECT account_number, balance_pence FROM accounts ORDER BY account_number',
  )
  return rows.map((r: { balance_pence: number }) => r.balance_pence)
}

/** Naive transfer: lock the source, then the destination. Order follows the request. */
async function transferNaive(from: string, to: string, pence: number, holdMs: number) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SELECT 1 FROM accounts WHERE account_number=$1 FOR UPDATE', [from])
    await new Promise((r) => setTimeout(r, holdMs)) // widen the window deterministically
    await c.query('SELECT 1 FROM accounts WHERE account_number=$1 FOR UPDATE', [to])
    await c.query(
      `UPDATE accounts SET balance_pence = balance_pence - $1
       WHERE account_number=$2 AND balance_pence >= $1`, [pence, from],
    )
    await c.query('UPDATE accounts SET balance_pence = balance_pence + $1 WHERE account_number=$2',
      [pence, to])
    await c.query('COMMIT')
    return 'OK'
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    return `ERROR:${(e as { code?: string }).code ?? (e as Error).message}`
  } finally { c.release() }
}

/** The fix: acquire row locks in a total order that does not depend on the request. */
async function transferOrdered(from: string, to: string, pence: number, holdMs: number) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const [first, second] = [from, to].sort() as [string, string]
    await c.query('SELECT 1 FROM accounts WHERE account_number=$1 FOR UPDATE', [first])
    await new Promise((r) => setTimeout(r, holdMs))
    await c.query('SELECT 1 FROM accounts WHERE account_number=$1 FOR UPDATE', [second])
    await c.query(
      `UPDATE accounts SET balance_pence = balance_pence - $1
       WHERE account_number=$2 AND balance_pence >= $1`, [pence, from],
    )
    await c.query('UPDATE accounts SET balance_pence = balance_pence + $1 WHERE account_number=$2',
      [pence, to])
    await c.query('COMMIT')
    return 'OK'
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    return `ERROR:${(e as { code?: string }).code ?? (e as Error).message}`
  } finally { c.release() }
}

describe('two transfers in opposite directions at the same time', () => {
  it('DEADLOCKS with request-ordered locking (Postgres error 40P01)', async () => {
    const results = await Promise.all([
      transferNaive(A, B, 1000, 150),
      transferNaive(B, A, 1000, 150),
    ])
    expect(results.some((r) => r === 'ERROR:40P01')).toBe(true)
    // Postgres detects and kills one side after deadlock_timeout (1s by default).
    // The victim is a 500 to the client unless it is caught and retried, and it took
    // a full second of held locks to get there.
  })

  it('does not deadlock with a total lock order', async () => {
    const results = await Promise.all([
      transferOrdered(A, B, 1000, 150),
      transferOrdered(B, A, 1000, 150),
    ])
    expect(results).toEqual(['OK', 'OK'])
    expect(await balances()).toEqual([10000, 10000]) // net zero, both applied
  })

  it('holds under a wider crossfire', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => transferOrdered(A, B, 500, 20)),
      ...Array.from({ length: 8 }, () => transferOrdered(B, A, 500, 20)),
    ])
    expect(results.filter((r) => r !== 'OK')).toEqual([])
    expect(await balances()).toEqual([10000, 10000])
  })
})
