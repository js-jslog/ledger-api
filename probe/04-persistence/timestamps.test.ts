import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema, truncateAll } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'
import { makeAccountRepo } from '../../src/repo/accounts.js'

/**
 * The spec requires `createdTimestamp` and `updatedTimestamp` on user and account
 * responses. The brief never says who maintains them; this verifies the answer
 * chosen here (a trigger) actually works, because moving a spec requirement into
 * the database is only an improvement if the database really does it.
 */

let db: Kysely<Database>
let repo: ReturnType<typeof makeAccountRepo>
let ids = 0

beforeAll(async () => {
  db = createDb()
  await resetSchema(db)
  await migrateToLatest(db)
  repo = makeAccountRepo(db, () => `tan-ts${String(++ids)}`)
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
  await db
    .insertInto('accounts')
    .values({
      account_number: '01000001',
      user_id: 'usr-owner',
      name: 'Personal',
      account_type: 'personal',
      balance_pennies: 10_000,
      currency: 'GBP',
    })
    .execute()
})

async function timestamps(): Promise<{ created: Date; updated: Date }> {
  const row = await db
    .selectFrom('accounts')
    .select(['created_at', 'updated_at'])
    .where('account_number', '=', '01000001')
    .executeTakeFirstOrThrow()
  return { created: row.created_at, updated: row.updated_at }
}

describe('updated_at is maintained by the database', () => {
  test('the driver returns real Date objects, not strings', async () => {
    // timestamptz is one of the types node-postgres does parse, unlike int8.
    const { created, updated } = await timestamps()
    expect(created).toBeInstanceOf(Date)
    expect(updated).toBeInstanceOf(Date)
  })

  test('a repository write the app never asked to timestamp still moves updated_at', async () => {
    const before = await timestamps()
    await new Promise((r) => setTimeout(r, 20))

    // debitIfSufficient sets only balance_pennies.
    const result = await repo.debitIfSufficient('01000001', 1_000, null)
    expect(result.isOk()).toBe(true)

    const after = await timestamps()
    expect(after.updated.getTime()).toBeGreaterThan(before.updated.getTime())
    // created_at must NOT move.
    expect(after.created.getTime()).toBe(before.created.getTime())
  })

  test('a deposit moves it too, without the repository mentioning it', async () => {
    const before = await timestamps()
    await new Promise((r) => setTimeout(r, 20))
    await repo.credit('01000001', 500, 'salary')
    const after = await timestamps()
    expect(after.updated.getTime()).toBeGreaterThan(before.updated.getTime())
  })

  test('transactions have no updated_at, because they are append-only', async () => {
    // §3: "Transactions are append-only. No update or delete path exists for
    // them, at any layer." The absence of the column is part of that guarantee --
    // there is nothing for an UPDATE to plausibly maintain.
    const columns = await db.introspection.getTables()
    const transactions = columns.find((t) => t.name === 'transactions')
    expect(transactions?.columns.map((c) => c.name)).not.toContain('updated_at')
  })
})
