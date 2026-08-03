// PROBE 11 — The brief's top pair-coding item: "client-supplied key, unique
// constraint, return the original result on replay."
//
// The plan is right in outline. This probe finds the two places it is under-specified
// and would cost time to discover live in front of an interviewer.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'

pg.types.setTypeParser(20, (v: string) => Number(v))
const pool = new pg.Pool({
  connectionString: 'postgres://ledger:ledger@localhost:5432/ledger', max: 10,
})
afterAll(async () => { await pool.end() })

const ACCT = '01000012'

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS idempotency_keys')
  await pool.query('DELETE FROM transactions')
  await pool.query('DELETE FROM accounts')
  await pool.query('DELETE FROM users')
  await pool.query(`INSERT INTO users (id,name,address,phone_number,email,password_hash)
    VALUES ('usr-p11','P','{}','+447700900011','p11@example.com','x')`)
  await pool.query(
    `INSERT INTO accounts (account_number,user_id,name,account_type,balance_pence)
     VALUES ($1,'usr-p11','X','personal',10000)`, [ACCT],
  )
  await pool.query(`
    CREATE TABLE idempotency_keys (
      account_number TEXT NOT NULL,
      key            TEXT NOT NULL,
      transaction_id TEXT,
      PRIMARY KEY (account_number, key)
    )`)
})

const balance = async () =>
  (await pool.query('SELECT balance_pence FROM accounts WHERE account_number=$1', [ACCT]))
    .rows[0].balance_pence

const txCount = async () =>
  (await pool.query('SELECT count(*) AS n FROM transactions')).rows[0].n

let seq = 0
/** Withdrawal guarded by an idempotency key, all inside one transaction. */
async function withdrawIdempotent(key: string, pence: number, holdMs = 0) {
  const c = await pool.connect()
  const txId = `tan-p11${seq++}`
  try {
    await c.query('BEGIN')
    // Claim the key first. A duplicate raises 23505 and aborts the transaction.
    await c.query('INSERT INTO idempotency_keys (account_number,key) VALUES ($1,$2)', [ACCT, key])
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs))
    const upd = await c.query(
      `UPDATE accounts SET balance_pence = balance_pence - $1
       WHERE account_number=$2 AND balance_pence >= $1`, [pence, ACCT],
    )
    if (upd.rowCount === 0) { await c.query('ROLLBACK'); return { outcome: 'INSUFFICIENT_FUNDS' } }
    await c.query(
      `INSERT INTO transactions (id,account_number,user_id,amount_pence,type)
       VALUES ($1,$2,'usr-p11',$3,'withdrawal')`, [txId, ACCT, pence],
    )
    await c.query('UPDATE idempotency_keys SET transaction_id=$1 WHERE account_number=$2 AND key=$3',
      [txId, ACCT, key])
    await c.query('COMMIT')
    return { outcome: 'CREATED', txId }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    const code = (e as { code?: string }).code
    if (code === '23505') return { outcome: 'REPLAY' }
    return { outcome: `ERROR:${code ?? (e as Error).message}` }
  } finally { c.release() }
}

describe('the plan as briefed', () => {
  it('WORKS: a sequential replay does not double-charge', async () => {
    const first = await withdrawIdempotent('k1', 3000)
    const second = await withdrawIdempotent('k1', 3000)
    expect(first.outcome).toBe('CREATED')
    expect(second.outcome).toBe('REPLAY')
    expect(await balance()).toBe(7000)
    expect(await txCount()).toBe(1)
  })

  it('WORKS: two *concurrent* requests with the same key charge once', async () => {
    const [a, b] = await Promise.all([
      withdrawIdempotent('k2', 3000, 120),
      withdrawIdempotent('k2', 3000, 120),
    ])
    expect([a.outcome, b.outcome].sort()).toEqual(['CREATED', 'REPLAY'])
    expect(await balance()).toBe(7000)
    expect(await txCount()).toBe(1)
  })
})

describe('what the plan does not yet say', () => {
  it('GAP 1: the replay branch has nothing to return', async () => {
    await withdrawIdempotent('k3', 3000)
    const replay = await withdrawIdempotent('k3', 3000)
    expect(replay.outcome).toBe('REPLAY')
    // "Return the original result" requires *reading* the original, in a fresh
    // transaction, because the 23505 aborted this one. The row is visible now:
    const { rows } = await pool.query(
      'SELECT transaction_id FROM idempotency_keys WHERE account_number=$1 AND key=$2',
      [ACCT, 'k3'],
    )
    expect(rows[0].transaction_id).toMatch(/^tan-/)
    // ...but only because the original COMMITTED. If the original request is still
    // in flight, transaction_id is NULL and there is no result to return yet. The
    // honest answer is 409 Conflict ("a request with this key is in progress"),
    // which the brief does not mention. Guessing at this live would cost minutes.
  })

  it('GAP 2: the same key with a *different* amount is silently accepted as a replay', async () => {
    await withdrawIdempotent('k4', 1000)
    const differentAmount = await withdrawIdempotent('k4', 9000)
    expect(differentAmount.outcome).toBe('REPLAY')
    expect(await balance()).toBe(9000) // the 90.00 request vanished with a success-ish reply
    // Stripe's answer is to fingerprint the request body against the key and return
    // 422 on mismatch. Without that, a client bug replays a key with new parameters
    // and gets told it succeeded. This is the detail that distinguishes "has read
    // about idempotency keys" from "has operated them".
  })

  it('GAP 3: a failed original leaves the key claimed or not, depending on ordering', async () => {
    // Insufficient funds rolls the whole transaction back, including the key claim,
    // so the key is reusable. That is usually right - but it means a retry of a
    // legitimately-failed request is NOT deduplicated, and if the failure was in
    // fact a timeout after commit, the client cannot tell.
    const first = await withdrawIdempotent('k5', 50000)
    expect(first.outcome).toBe('INSUFFICIENT_FUNDS')
    const { rows } = await pool.query(
      'SELECT count(*) AS n FROM idempotency_keys WHERE key=$1', ['k5'],
    )
    expect(rows[0].n).toBe(0) // key released
    const retry = await withdrawIdempotent('k5', 3000)
    expect(retry.outcome).toBe('CREATED') // same key, different outcome, allowed
  })
})
