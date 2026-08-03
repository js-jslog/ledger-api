// PROBE 03 — "integer pennies as `number` in a BIGINT column".
//
// Kysely's table types are hand-declared here, exactly as they would be in the real
// build. The type says `number`. The probe asks whether the value at runtime is one.
import { afterAll, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'

interface DB {
  accounts: {
    account_number: string
    user_id: string
    name: string
    account_type: string
    balance_pence: number // <-- the declared type
    currency: string
    created_timestamp: Date
    updated_timestamp: Date
  }
  users: {
    id: string; name: string; address: unknown; phone_number: string
    email: string; password_hash: string
    created_timestamp: Date; updated_timestamp: Date
  }
  transactions: {
    id: string; account_number: string; user_id: string; amount_pence: number
    currency: string; type: string; reference: string | null; created_timestamp: Date
  }
}

const pool = new pg.Pool({
  connectionString: 'postgres://ledger:ledger@localhost:5432/ledger',
})
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })

afterAll(async () => { await db.destroy() })

describe('BIGINT round-trip through node-postgres', () => {
  it('BREAKS: the column typed `number` comes back as a string', async () => {
    // Order matters, and so does deleting tables this file never writes to:
    // serialised test files still inherit whatever the previous file left behind.
    await db.deleteFrom('transactions').execute()
    await db.deleteFrom('accounts').execute()
    await db.deleteFrom('users').execute()
    await db.insertInto('users').values({
      id: 'usr-p03', name: 'Probe', address: JSON.stringify({}) as never,
      phone_number: '+447700900000', email: 'p03@example.com', password_hash: 'x',
    } as never).execute()
    await db.insertInto('accounts').values({
      account_number: '01000003', user_id: 'usr-p03', name: 'Probe Account',
      account_type: 'personal', balance_pence: 1099,
    } as never).execute()

    const row = await db.selectFrom('accounts')
      .select('balance_pence')
      .where('account_number', '=', '01000003')
      .executeTakeFirstOrThrow()

    // TypeScript is convinced this is a number. Postgres/pg disagree.
    expect(typeof row.balance_pence).toBe('string')
    expect(row.balance_pence as unknown).toBe('1099')
  })

  it('and the failure is silent and *plausible* downstream', async () => {
    const row = await db.selectFrom('accounts')
      .select('balance_pence')
      .where('account_number', '=', '01000003')
      .executeTakeFirstOrThrow()

    const pence = row.balance_pence // typed number, actually string '1099'

    // The response mapper divides by 100. String / number coerces, so this *works*:
    expect(pence / 100).toBe(10.99)

    // But a sufficient-funds check in application code does not:
    // A sufficient-funds check also coerces, so it happens to pass:
    const withdrawalPence = 500
    expect(pence >= withdrawalPence).toBe(true)

    // The bite is addition, which concatenates instead of adding. The column is
    // typed `number`, so the compiler raises nothing at all.
    const newBalance = pence + 500
    expect(typeof newBalance).toBe('string')
    expect(newBalance as unknown).toBe('1099500') // 10,995.00 pounds, not 15.99
  })
})

describe('the fix, and what else it touches', () => {
  it('a global int8 type parser makes the declared type honest', async () => {
    // OID 20 = int8. This is process-global, set once at the composition root.
    pg.types.setTypeParser(20, (v: string) => {
      const n = Number(v)
      if (!Number.isSafeInteger(n)) throw new Error(`int8 ${v} exceeds Number.MAX_SAFE_INTEGER`)
      return n
    })
    const fresh = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: 'postgres://ledger:ledger@localhost:5432/ledger' }),
      }),
    })
    const row = await fresh.selectFrom('accounts')
      .select('balance_pence')
      .where('account_number', '=', '01000003')
      .executeTakeFirstOrThrow()
    expect(typeof row.balance_pence).toBe('number')
    expect(row.balance_pence + 500).toBe(1599)
    await fresh.destroy()
  })

  it('SIDE EFFECT: count() is also int8, so the DELETE-user 409 check was a string too', async () => {
    // `count(*)` returns int8. Before the parser it is a string, and
    // `if (count > 0)` on the string '0' is false while '0' itself is truthy —
    // exactly the shape of bug that lets a user with accounts be deleted.
    expect(Number('0') > 0).toBe(false)
    expect(Boolean('0')).toBe(true) // the tempting shorthand is wrong

    const { rows } = await pool.query('SELECT count(*) AS n FROM accounts')
    expect(typeof rows[0].n).toBe('number') // now a number, thanks to the parser
  })
})

describe('was BIGINT the right column type at all?', () => {
  it('INTEGER needs no parser, and its range is 2000x the spec ceiling', async () => {
    await pool.query('DROP TABLE IF EXISTS int_probe')
    await pool.query('CREATE TABLE int_probe (as_int4 INTEGER, as_int8 BIGINT, as_numeric NUMERIC(12,2))')
    await pool.query('INSERT INTO int_probe VALUES (1000000, 1000000, 10000.00)')

    // NOTE: a "fresh" pool is not fresh. `pg.types.setTypeParser` mutates module-level
    // state shared by every pool in the process, so the parser installed by the test
    // above is still in effect here. That is itself worth knowing: you cannot have
    // parsed and unparsed int8 coexisting, and any dependency that assumed int8-as-
    // string silently changes behaviour the moment the parser is installed.
    const anotherPool = new pg.Pool({ connectionString: 'postgres://ledger:ledger@localhost:5432/ledger' })
    const { rows } = await anotherPool.query('SELECT * FROM int_probe')
    expect(typeof rows[0].as_int4).toBe('number') // int4 (oid 23): number, no parser needed
    expect(typeof rows[0].as_int8).toBe('number') // int8: number only because of the global parser
    expect(typeof rows[0].as_numeric).toBe('string') // numeric (oid 1700): still a string
    await anotherPool.end()

    // int4 needs no parser at all. Verified against a subprocess with no parser
    // installed would be belt-and-braces; the OID mapping in pg's source is
    // unambiguous (builtins.INT4 is parsed with parseInt by default).

    // The spec caps a balance at 10000.00 = 1,000,000 pence.
    // INTEGER holds 2,147,483,647 pence = 21,474,836.47 pounds.
    expect(2_147_483_647).toBeGreaterThan(1_000_000 * 2000)
    // So BIGINT buys no headroom that matters here, and is the specific choice that
    // creates the string-coercion bug class the type parser then has to repair.
    // BIGINT is the right answer for a real ledger (where a total-value column can
    // exceed 2^31 pence) but that is an argument to make deliberately, not by reflex.
  })
})
