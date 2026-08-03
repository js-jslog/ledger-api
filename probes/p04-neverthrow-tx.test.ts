// PROBE 04 — Do `neverthrow` errors roll back a Kysely transaction?
//
// The brief settles on both "neverthrow for errors" and "an explicit transaction"
// for withdrawals. These two decisions interact. Kysely's transaction API rolls back
// when the callback *throws*. An errors-as-values codebase does not throw.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { err, ok, type Result } from 'neverthrow'

pg.types.setTypeParser(20, (v: string) => Number(v))

interface DB {
  accounts: {
    account_number: string; user_id: string; name: string; account_type: string
    balance_pence: number; currency: string
    created_timestamp: Date; updated_timestamp: Date
  }
  transactions: {
    id: string; account_number: string; user_id: string; amount_pence: number
    currency: string; type: 'deposit' | 'withdrawal'; reference: string | null
    created_timestamp: Date
  }
  users: {
    id: string; name: string; address: unknown; phone_number: string
    email: string; password_hash: string
    created_timestamp: Date; updated_timestamp: Date
  }
}

const pool = new pg.Pool({ connectionString: 'postgres://ledger:ledger@localhost:5432/ledger' })
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })
afterAll(async () => { await db.destroy() })

const balanceOf = async (acct: string) =>
  (await db.selectFrom('accounts').select('balance_pence')
    .where('account_number', '=', acct).executeTakeFirstOrThrow()).balance_pence

const txCount = async (acct: string) =>
  (await db.selectFrom('transactions').select(db.fn.countAll<number>().as('n'))
    .where('account_number', '=', acct).executeTakeFirstOrThrow()).n

beforeEach(async () => {
  await db.deleteFrom('transactions').execute()
  await db.deleteFrom('accounts').execute()
  await db.deleteFrom('users').execute()
  await db.insertInto('users').values({
    id: 'usr-p04', name: 'Probe', address: JSON.stringify({}) as never,
    phone_number: '+447700900000', email: 'p04@example.com', password_hash: 'x',
  } as never).execute()
  await db.insertInto('accounts').values({
    account_number: '01000004', user_id: 'usr-p04', name: 'A',
    account_type: 'personal', balance_pence: 10_000,
  } as never).execute()
})

type TxError = { kind: 'INSUFFICIENT_FUNDS' }

describe('returning err() from inside a transaction callback', () => {
  it('BREAKS: the transaction COMMITS the partial work anyway', async () => {
    const result: Result<never, TxError> = await db.transaction().execute(async (trx) => {
      // Step 1: write the ledger row.
      await trx.insertInto('transactions').values({
        id: 'tan-p04a', account_number: '01000004', user_id: 'usr-p04',
        amount_pence: 50_000, currency: 'GBP', type: 'withdrawal', reference: null,
      } as never).execute()

      // Step 2: the conditional balance update fails to match — insufficient funds.
      const upd = await trx.updateTable('accounts')
        .set((eb) => ({ balance_pence: eb('balance_pence', '-', 50_000) }))
        .where('account_number', '=', '01000004')
        .where('balance_pence', '>=', 50_000)
        .executeTakeFirst()

      if (Number(upd.numUpdatedRows) === 0) {
        // Idiomatic errors-as-values. No throw. Kysely sees a *resolved* promise.
        return err({ kind: 'INSUFFICIENT_FUNDS' } as const)
      }
      return ok(undefined as never)
    })

    expect(result.isErr()).toBe(true) // the service correctly reports 422...
    expect(await balanceOf('01000004')).toBe(10_000) // ...balance untouched, good...
    expect(await txCount('01000004')).toBe(1) // ...but a phantom £500 withdrawal is on the ledger
  })

  it('the workaround: throw a carrier and re-wrap outside', async () => {
    class Rollback extends Error {
      constructor(readonly cause: TxError) { super('rollback') }
    }
    const run = async (): Promise<Result<void, TxError>> => {
      try {
        return await db.transaction().execute(async (trx) => {
          await trx.insertInto('transactions').values({
            id: 'tan-p04b', account_number: '01000004', user_id: 'usr-p04',
            amount_pence: 50_000, currency: 'GBP', type: 'withdrawal', reference: null,
          } as never).execute()
          const upd = await trx.updateTable('accounts')
            .set((eb) => ({ balance_pence: eb('balance_pence', '-', 50_000) }))
            .where('account_number', '=', '01000004')
            .where('balance_pence', '>=', 50_000)
            .executeTakeFirst()
          if (Number(upd.numUpdatedRows) === 0) {
            throw new Rollback({ kind: 'INSUFFICIENT_FUNDS' })
          }
          return ok(undefined)
        })
      } catch (e) {
        if (e instanceof Rollback) return err(e.cause)
        throw e
      }
    }

    const result = await run()
    expect(result.isErr()).toBe(true)
    expect(await balanceOf('01000004')).toBe(10_000)
    expect(await txCount('01000004')).toBe(0) // rolled back correctly
  })
})
