import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { truncateAll } from '../../test/db/truncate.js'
import { capturedLogs } from '../../test/observability/captured-logs.js'
import { connect, testDatabaseUrl } from '../db/connection.js'
import { newUserId } from '../domain/ids.js'
import type { Pennies } from '../domain/money.js'
import { accountsRepository, credit, debitIfSufficient } from './accounts.js'
import { usersRepository } from './users.js'

/**
 * THE ONLY TESTS IN THIS PROJECT THAT ARE NOT DRIVEN THROUGH THE API, and the reason is the
 * finding rather than a preference. `debitIfSufficient` answers `accountGone` where a
 * zero-row update might otherwise be read as insufficient funds — the correction the whole
 * withdrawal design turns on, and R37 names it as one of the three decisions no mechanism can
 * check. Through HTTP it is unreachable: the ownership resolve runs first, and nothing this
 * service publishes can remove an account between that and the debit, because
 * `DELETE /v1/accounts/{accountNumber}` is deferred (R2).
 *
 * Measured rather than assumed. With the existence check deleted and the failure path
 * returning `insufficientFunds` unconditionally, the entire suite stayed green — 170 tests,
 * nothing noticed. A branch with no witness is indistinguishable from one that is switched
 * off, so the branch is exercised here, one layer below the endpoint, where the case can be
 * constructed at all.
 */
const db = connect(testDatabaseUrl())
const accounts = accountsRepository(db)
const users = usersRepository(db)

capturedLogs()

beforeEach(async () => {
  await truncateAll(db)
})

afterAll(async () => {
  await db.destroy()
})

const openAccount = async (): Promise<string> => {
  const user = await users
    .create_userRzA({
      id: newUserId(),
      name: 'Test User',
      address: { line1: '1 Test Street', town: 'Testville', county: 'Testshire', postcode: 'TE1 1ST' },
      phoneNumber: '+441234567890',
      email: 'test@example.com',
      passwordHash: 'not-a-real-hash',
    })
    .match(
      (created) => created,
      (error) => {
        throw new Error(error.message)
      },
    )

  return accounts
    .create_accountRzA({ userId: user.id, name: 'Personal Bank Account', accountType: 'personal' })
    .match(
      (created) => created.accountNumber,
      (error) => {
        throw new Error(error.message)
      },
    )
}

const balanceOf = async (accountNumber: string): Promise<number> =>
  (
    await db
      .selectFrom('accounts')
      .select('balance')
      .where('account_number', '=', accountNumber)
      .executeTakeFirstOrThrow()
  ).balance

const pennies = (amount: number): Pennies => amount as Pennies

describe('debitIfSufficient', () => {
  test('applies the debit and computes the new balance from the row', async () => {
    const accountNumber = await openAccount()
    await credit(db, accountNumber, pennies(10_000))

    expect(await debitIfSufficient(db, accountNumber, pennies(3050))).toBe('applied')
    expect(await balanceOf(accountNumber)).toBe(6950)
  })

  test('reports insufficient funds and moves nothing when the balance is too small', async () => {
    const accountNumber = await openAccount()
    await credit(db, accountNumber, pennies(5000))

    expect(await debitIfSufficient(db, accountNumber, pennies(5001))).toBe('insufficientFunds')
    expect(await balanceOf(accountNumber)).toBe(5000)
  })

  /** Exactly the balance is sufficient, which is the boundary `>=` decides. */
  test('applies a debit for the whole balance', async () => {
    const accountNumber = await openAccount()
    await credit(db, accountNumber, pennies(5000))

    expect(await debitIfSufficient(db, accountNumber, pennies(5000))).toBe('applied')
    expect(await balanceOf(accountNumber)).toBe(0)
  })

  /**
   * THE CASE THIS FILE EXISTS FOR. A zero-row update against an account that is not there
   * must not be reported as insufficient funds — that is the misreport R1 catalogues, and
   * with the existence check removed this is the only assertion in the project that changes.
   */
  test('reports the account gone rather than insufficient funds when there is no row', async () => {
    expect(await debitIfSufficient(db, '01999999', pennies(1))).toBe('accountGone')
  })
})

describe('credit', () => {
  test('adds to the balance', async () => {
    const accountNumber = await openAccount()

    expect(await credit(db, accountNumber, pennies(1099))).toBe('applied')
    expect(await balanceOf(accountNumber)).toBe(1099)
  })

  /**
   * The deposit's version of the same race, and it needs no existence check to answer it:
   * there is no condition on the balance, so zero rows can only mean the row is absent.
   */
  test('reports the account gone when there is no row', async () => {
    expect(await credit(db, '01999999', pennies(1099))).toBe('accountGone')
  })
})
