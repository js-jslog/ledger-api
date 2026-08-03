// PROBE 12 — The Kysely `DB` interface is an *assertion* about the SQL schema, not
// a derivation from it. The brief's stated preference is to replace developer
// discipline with deterministic tooling; this probe shows what discipline is
// currently carrying, and how loudly it fails when it lapses.
import { afterAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'

pg.types.setTypeParser(20, (v: string) => Number(v))
const CONN = 'postgres://ledger:ledger@localhost:5432/ledger'
const pool = new pg.Pool({ connectionString: CONN })
afterAll(async () => { await pool.end() })

describe('drift between schema.sql and the hand-written types', () => {
  it('a nullable column typed non-nullable compiles and yields null at runtime', async () => {
    // `reference` is `TEXT` (nullable) in schema.sql. Suppose the interface said
    // `reference: string`. Nothing anywhere catches it.
    interface Wrong {
      transactions: {
        id: string; account_number: string; user_id: string; amount_pence: number
        currency: string; type: string
        reference: string // <-- the lie
        created_timestamp: Date
      }
    }
    const db = new Kysely<Wrong>({ dialect: new PostgresDialect({ pool }) })
    await pool.query('DELETE FROM transactions')
    await pool.query('DELETE FROM accounts')
    await pool.query('DELETE FROM users')
    await pool.query(`INSERT INTO users (id,name,address,phone_number,email,password_hash)
      VALUES ('usr-p12','P','{}','+447700900012','p12@example.com','x')`)
    await pool.query(`INSERT INTO accounts (account_number,user_id,name,account_type)
      VALUES ('01000013','usr-p12','X','personal')`)
    await pool.query(`INSERT INTO transactions (id,account_number,user_id,amount_pence,type)
      VALUES ('tan-p12','01000013','usr-p12',100,'deposit')`)

    const row = await db.selectFrom('transactions').select('reference')
      .where('id', '=', 'tan-p12').executeTakeFirstOrThrow()

    // TypeScript believes this is a string. It is null.
    expect(row.reference).toBeNull()
    // The bug surfaces at whatever call site first does `row.reference.trim()`,
    // arbitrarily far from the cause, as a TypeError in production.
    expect(() => (row.reference as string).trim()).toThrow(TypeError)
  })

  it('a column that does not exist is a *runtime* error, not a compile error', async () => {
    interface Wrong {
      accounts: { account_number: string; balance_pennies: number } // renamed by hand
    }
    const db = new Kysely<Wrong>({ dialect: new PostgresDialect({ pool }) })
    // Compiles cleanly. Fails at query time with 42703 undefined_column.
    await expect(
      db.selectFrom('accounts').select('balance_pennies').execute(),
    ).rejects.toMatchObject({ code: '42703' })
    // So the whole class is caught only by tests that actually hit the database.
    // That makes DB-backed integration tests load-bearing, not optional - a real
    // constraint on a 12-hour budget, and worth saying out loud rather than
    // presenting the type safety as end-to-end.
  })
})
