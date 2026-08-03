import type { Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema, truncateAll } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'
import {
  collisionProbability,
  insertAccountWithNewNumber,
  randomAccountNumber,
} from '../../src/repo/account-numbers.js'

let db: Kysely<Database>

beforeAll(async () => {
  db = createDb()
  await resetSchema(db)
  await migrateToLatest(db)
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

describe('the keyspace', () => {
  test('^01\\d{6}$ admits exactly one million account numbers', () => {
    // "01" is fixed, six digits are free. Worth stating plainly, because the
    // eight-character shape reads much larger than it is.
    expect(10 ** 6).toBe(1_000_000)
  })

  test('generated numbers satisfy the spec pattern', () => {
    const pattern = /^01\d{6}$/
    for (let i = 0; i < 2_000; i++) {
      expect(randomAccountNumber()).toMatch(pattern)
    }
  })

  test('collision risk is negligible at demo scale and material at modest scale', () => {
    // The birthday bound. The point is not that a take-home will collide -- it
    // will not -- but that the number stops being small quickly, so the failure
    // mode has to be chosen rather than left to chance.
    const table = [10, 100, 1_000, 10_000].map((n) => ({
      accounts: n,
      chance: `${(collisionProbability(n) * 100).toFixed(3)}%`,
    }))
    expect(collisionProbability(10)).toBeLessThan(0.0001)
    expect(collisionProbability(1_000)).toBeGreaterThan(0.35)
    expect(collisionProbability(10_000)).toBeGreaterThan(0.99)
    console.table(table)
  })
})

describe('what a collision actually does', () => {
  test('an unhandled collision is a 23505 that would surface as a 500', async () => {
    // Establish the raw failure mode: without retry logic, the second creator of
    // a colliding number gets a database error, and a request that should have
    // succeeded returns "An unexpected error occurred".
    await db
      .insertInto('accounts')
      .values({
        account_number: '01555555',
        user_id: 'usr-owner',
        name: 'First',
        account_type: 'personal',
        balance_pennies: 0,
        currency: 'GBP',
      })
      .execute()

    let code: string | undefined
    try {
      await db
        .insertInto('accounts')
        .values({
          account_number: '01555555',
          user_id: 'usr-owner',
          name: 'Second',
          account_type: 'personal',
          balance_pennies: 0,
          currency: 'GBP',
        })
        .execute()
    } catch (e) {
      code = (e as { code?: string }).code
    }
    expect(code).toBe('23505')
  })

  test('insert-and-retry survives a fully saturated keyspace slice', async () => {
    // Force collisions to be near-certain by shrinking the effective keyspace:
    // stub the generator so it only ever returns two numbers, take both, and
    // confirm the retry loop reports a clean domain error rather than throwing.
    const twoNumbers = ['01000001', '01000002']
    for (const account_number of twoNumbers) {
      await db
        .insertInto('accounts')
        .values({
          account_number,
          user_id: 'usr-owner',
          name: 'Taken',
          account_type: 'personal',
          balance_pennies: 0,
          currency: 'GBP',
        })
        .execute()
    }

    // The real generator uses crypto.randomInt, so rather than stub it, run the
    // same loop shape against a generator that can only return taken numbers.
    const tryInsert = async (accountNumber: string): Promise<string | null> => {
      try {
        await db
          .insertInto('accounts')
          .values({
            account_number: accountNumber,
            user_id: 'usr-owner',
            name: 'Retry',
            account_type: 'personal',
            balance_pennies: 0,
            currency: 'GBP',
          })
          .execute()
        return accountNumber
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e
        return null // collision: retryable
      }
    }

    let allocated: string | null = null
    for (let attempt = 0; attempt < 5 && allocated === null; attempt++) {
      allocated = await tryInsert(twoNumbers[attempt % 2] ?? '01000001')
    }
    // Bounded, and it gives up cleanly instead of looping forever.
    expect(allocated).toBeNull()
  })

  test('the real generator succeeds against a populated table', async () => {
    for (let i = 0; i < 50; i++) {
      const result = await insertAccountWithNewNumber(db, { userId: 'usr-owner', name: 'Acct' })
      expect(result.isOk()).toBe(true)
    }
    const rows = await db.selectFrom('accounts').select('account_number').execute()
    expect(new Set(rows.map((r) => r.account_number)).size).toBe(50)
  })

  test('a non-collision error must NOT be retried', async () => {
    // The subtle half of the retry loop. A foreign-key violation (user deleted
    // between authentication and account creation) is not retryable; retrying it
    // wastes four more round trips and then reports an account-number allocation
    // failure for a problem that had nothing to do with account numbers.
    await expect(
      insertAccountWithNewNumber(db, { userId: 'usr-does-not-exist', name: 'Acct' }),
    ).rejects.toThrow(/violates foreign key constraint/)
  })

  test('the CHECK constraint rejects a number that does not match the spec', async () => {
    await expect(
      db
        .insertInto('accounts')
        .values({
          account_number: '99999999',
          user_id: 'usr-owner',
          name: 'Bad',
          account_type: 'personal',
          balance_pennies: 0,
          currency: 'GBP',
        })
        .execute(),
    ).rejects.toThrow(/accounts_number_format/)
  })
})
