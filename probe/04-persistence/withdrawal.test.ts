import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema, truncateAll } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'
import { makeAccountRepo } from '../../src/repo/accounts.js'

/**
 * §7's mechanism, re-verified independently rather than taken on trust, plus a
 * probe of the *reasoning* attached to it — which is where the problem is.
 */

let db: Kysely<Database>
let repo: ReturnType<typeof makeAccountRepo>
let idCounter = 0

beforeAll(async () => {
  db = createDb()
  await resetSchema(db)
  await migrateToLatest(db)
  repo = makeAccountRepo(db, () => `tan-probe${String(++idCounter)}`)
})

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await truncateAll(db)
  await db
    .insertInto('users')
    .values({
      id: 'usr-owner',
      name: 'Owner',
      email: 'owner@example.com',
      password_hash: 'x',
      address_line1: '1 Street',
      address_line2: null,
      address_line3: null,
      address_town: 'Town',
      address_county: 'County',
      address_postcode: 'M1 1AA',
      phone_number: '+447700900000',
    })
    .execute()
})

async function makeAccount(balancePennies: number, accountNumber = '01000001'): Promise<string> {
  await db
    .insertInto('accounts')
    .values({
      account_number: accountNumber,
      user_id: 'usr-owner',
      name: 'Personal',
      account_type: 'personal',
      balance_pennies: balancePennies,
      currency: 'GBP',
    })
    .execute()
  return accountNumber
}

async function balanceOf(accountNumber: string): Promise<number> {
  const row = await db
    .selectFrom('accounts')
    .select('balance_pennies')
    .where('account_number', '=', accountNumber)
    .executeTakeFirstOrThrow()
  return row.balance_pennies
}

describe('§7 conditional UPDATE under real contention', () => {
  test('two simultaneous full withdrawals: one succeeds, one gets 422', async () => {
    const account = await makeAccount(10_000) // £100.00

    const [a, b] = await Promise.all([
      repo.debitIfSufficient(account, 10_000, null),
      repo.debitIfSufficient(account, 10_000, null),
    ])

    const succeeded = [a, b].filter((r) => r.isOk())
    const failed = [a, b].filter((r) => r.isErr())
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]?._unsafeUnwrapErr().kind).toBe('InsufficientFunds')

    expect(await balanceOf(account)).toBe(0)
    const rows = await db.selectFrom('transactions').selectAll().execute()
    expect(rows).toHaveLength(1) // exactly one transaction row
  })

  test('twenty concurrent £10 withdrawals from £100: exactly ten succeed', async () => {
    const account = await makeAccount(10_000)

    const results = await Promise.all(
      Array.from({ length: 20 }, () => repo.debitIfSufficient(account, 1_000, null)),
    )

    expect(results.filter((r) => r.isOk())).toHaveLength(10)
    expect(results.filter((r) => r.isErr())).toHaveLength(10)
    expect(await balanceOf(account)).toBe(0)
    expect(await db.selectFrom('transactions').selectAll().execute()).toHaveLength(10)
  })

  test('the naive read-modify-write loses the update, for contrast', async () => {
    const account = await makeAccount(10_000)

    // What the port shape exists to make inexpressible: read the balance, decide
    // in application code, write the computed value back.
    const naiveWithdraw = async (amount: number): Promise<boolean> => {
      const row = await db
        .selectFrom('accounts')
        .select('balance_pennies')
        .where('account_number', '=', account)
        .executeTakeFirstOrThrow()
      if (row.balance_pennies < amount) return false
      await new Promise((r) => setTimeout(r, 10)) // the window
      await db
        .updateTable('accounts')
        .set({ balance_pennies: row.balance_pennies - amount })
        .where('account_number', '=', account)
        .execute()
      return true
    }

    const outcomes = await Promise.all([naiveWithdraw(10_000), naiveWithdraw(10_000)])
    expect(outcomes).toEqual([true, true]) // both "succeed"
    expect(await balanceOf(account)).toBe(0) // £200 withdrawn from a £100 account
  })

  test('the CHECK constraint backstops a negative balance', async () => {
    const account = await makeAccount(10_000)
    await expect(
      db
        .updateTable('accounts')
        .set({ balance_pennies: -1 })
        .where('account_number', '=', account)
        .execute(),
    ).rejects.toThrow(/accounts_balance_non_negative/)
  })
})

describe('§7 isolation-level claims', () => {
  test('REPEATABLE READ raises a serialisation failure instead of re-evaluating', async () => {
    const account = await makeAccount(10_000)

    // §7: "Under REPEATABLE READ or SERIALIZABLE, Postgres raises a
    // serialisation failure rather than re-evaluating, so retry logic becomes
    // necessary." Verified here so the claim is not folklore.
    const withdrawRepeatableRead = async (): Promise<string> => {
      try {
        await db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
          await sql`select pg_sleep(0.05)`.execute(tx)
          await tx
            .updateTable('accounts')
            .set((eb) => ({ balance_pennies: eb('balance_pennies', '-', 1_000) }))
            .where('account_number', '=', account)
            .where('balance_pennies', '>=', 1_000)
            .execute()
        })
        return 'ok'
      } catch (e) {
        return (e as { code?: string }).code ?? 'unknown'
      }
    }

    const outcomes = await Promise.all([withdrawRepeatableRead(), withdrawRepeatableRead()])
    expect(outcomes).toContain('40001') // could not serialize access
  })
})

describe('§7\'s 422 reasoning -- where it breaks', () => {
  test('a zero-row update does NOT only mean insufficient funds', async () => {
    // §7: "because it runs first, a zero-row update can only mean insufficient
    // funds -> 422."
    //
    // The ownership resolve and the debit are two separate statements on two
    // separate connections. Anything that removes the row in between produces a
    // zero-row update for a reason that is not insufficient funds. Here the
    // account is deleted after a successful resolve -- exactly the DELETE
    // /v1/accounts/{accountNumber} endpoint the brief defers, racing the
    // transaction endpoint it builds.
    const account = await makeAccount(10_000)

    const resolved = await repo.resolveForOwner(account, 'usr-owner')
    expect(resolved.isOk()).toBe(true) // ownership established: not 403, not 404

    await db.deleteFrom('accounts').where('account_number', '=', account).execute()

    const result = await repo.debitIfSufficient(account, 1_000, null)
    expect(result.isErr()).toBe(true)
    // Reported as 422 "Insufficient funds" for an account that does not exist.
    // The correct answer is 404. An account with a £100 balance is described to
    // the client as having insufficient funds for a £10 withdrawal.
    expect(result._unsafeUnwrapErr().kind).toBe('InsufficientFunds')
  })

  test('distinguishing the two costs one extra clause, not an extra query', async () => {
    // The fix keeps the single conditional UPDATE and disambiguates afterwards:
    // if zero rows were updated, ask whether the row exists at all. That second
    // question is only asked on the failure path, so the happy path is unchanged.
    const account = await makeAccount(10_000)
    await db.deleteFrom('accounts').where('account_number', '=', account).execute()

    const debit = await repo.debitIfSufficient(account, 1_000, null)
    expect(debit.isErr()).toBe(true)

    const stillThere = await db
      .selectFrom('accounts')
      .select('account_number')
      .where('account_number', '=', account)
      .executeTakeFirst()
    expect(stillThere).toBeUndefined() // -> the failure was 404, not 422
  })
})
