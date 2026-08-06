import type { Kysely, Selectable } from 'kysely'
import { ResultAsync } from 'neverthrow'

import type { AccountsTable, Database } from '../db/schema.js'
import { unexpected, type DomainError } from '../domain/errors.js'
import { newAccountNumber } from '../domain/ids.js'
import type { Pennies } from '../domain/money.js'

/**
 * What the caller supplies. There is no `accountNumber` and no `balance`: the number is
 * minted below because minting it is inseparable from checking it is free, and the opening
 * balance is the column default — `AccountsTable` declares `never` in the insert position
 * so neither can be passed in.
 */
export type NewAccount = {
  readonly userId: string
  readonly name: string
  readonly accountType: string
}

export type AccountRecord = {
  readonly accountNumber: string
  readonly userId: string
  readonly name: string
  readonly accountType: string
  readonly balance: Pennies
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type AccountsRepository = {
  readonly create_accountRzA: (account: NewAccount) => ResultAsync<AccountRecord, DomainError>
  readonly find_accountByNumberRzA: (
    accountNumber: string,
  ) => ResultAsync<AccountRecord | undefined, DomainError>
}

/** The primary key in `migrations/003-accounts.ts`, matched by name below. */
const ACCOUNT_NUMBER_KEY = 'accounts_pkey'

/**
 * By constraint name, not by `23505` alone, for the reason `src/repo/users.ts` already
 * spells out for the email index: `23505` means "some unique constraint", so a later index
 * on this table would otherwise be retried as though it were a colliding account number —
 * and the retry would exhaust and report an internal error for what is really a duplicate
 * of something else.
 */
const isDuplicateAccountNumber = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  cause.code === '23505' &&
  'constraint' in cause &&
  cause.constraint === ACCOUNT_NUMBER_KEY

/**
 * Three, and the number barely matters — which is the useful thing to know about it.
 *
 * With one million account numbers, the chance of two consecutive collisions is the square
 * of an already small number, so raising this to ten buys nothing measurable. What it is
 * for is the concurrent case: two requests minting the same number in the same instant is
 * a race no `select`-then-`insert` check would close, and one retry settles it. Exhausting
 * three is not "the table is full", it is "something is wrong", and it surfaces as a 500.
 */
const ATTEMPTS = 3

/**
 * Insert and translate, never check-then-insert. Between a `select` for a free number and
 * the `insert` that takes it, another request can take it — so the check-first version
 * fails exactly under the load that makes collisions likely in the first place. The
 * database's uniqueness is the check, and this loop is how the answer is read.
 *
 * Written as a throwing loop rather than a chain of `ResultAsync`s deliberately: retrying
 * means recovering from the error channel and putting the same operation back, which reads
 * as a knot in a combinator chain and as a `for` loop here. It is wrapped once, at the
 * boundary below, so nothing outside this file sees an exception.
 */
const insertAccount = async (
  db: Kysely<Database>,
  account: NewAccount,
): Promise<Selectable<AccountsTable>> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db
        .insertInto('accounts')
        .values({
          account_number: newAccountNumber(),
          user_id: account.userId,
          name: account.name,
          account_type: account.accountType,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    } catch (cause) {
      if (attempt === ATTEMPTS || !isDuplicateAccountNumber(cause)) throw cause
    }
  }
}

const toAccountRecord = (row: Selectable<AccountsTable>): AccountRecord => ({
  accountNumber: row.account_number,
  userId: row.user_id,
  name: row.name,
  accountType: row.account_type,
  balance: row.balance,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/**
 * What the balance change did, reported rather than judged. Which status each of these
 * deserves is the service's decision, for the reason the README's walkthrough gives at step
 * 3 — and here that is more than a convention, because `accountGone` versus
 * `insufficientFunds` is the taxonomy the whole design of this endpoint turns on.
 */
export type BalanceChange = 'applied' | 'insufficientFunds' | 'accountGone'

/**
 * THE WITHDRAWAL, AND IT TAKES NO BALANCE. The new value is computed from the row's current
 * value inside the database, so passing in a balance read a moment ago would not be wrong
 * today — it would merely look like a read-then-write, which is the shape that invites
 * someone to "optimise" it into one. There is no parameter to pass it through, so reusing an
 * earlier read is not expressible. Structural, not a comment.
 *
 * WHY THE ARITHMETIC IS SAFE WITHOUT A LOCK. Under READ COMMITTED, a second transaction
 * updating this row blocks on the first's row lock, and when the first commits it does not
 * proceed against its stale snapshot — it re-reads the row and re-evaluates this `where`
 * clause against the committed balance. So the second withdrawal is tested against the
 * balance the first one left. No lost update, and no explicit lock.
 *
 * WHY THE SECOND QUERY EXISTS, which is the correction this endpoint was designed around. A
 * zero-row update does NOT mean insufficient funds. The ownership resolve ran earlier on a
 * different connection, so anything that removed the row in between produces the same zero
 * rows — and reporting that as 422 tells a client its account has insufficient funds when
 * the account does not exist. The existence check runs only on the failure path and costs
 * nothing on the happy one. It narrows that misreport to a window of microseconds; it does
 * not eliminate it, and R1 records both the residual and the locking version that closes it.
 */
export const debitIfSufficient = async (
  db: Kysely<Database>,
  accountNumber: string,
  amount: Pennies,
): Promise<BalanceChange> => {
  const debited = await db
    .updateTable('accounts')
    .set((eb) => ({ balance: eb('balance', '-', amount) }))
    .where('account_number', '=', accountNumber)
    .where('balance', '>=', amount)
    .returning('balance')
    .executeTakeFirst()

  if (debited !== undefined) return 'applied'

  return (await exists(db, accountNumber)) ? 'insufficientFunds' : 'accountGone'
}

/**
 * The deposit's half, and the asymmetry is the whole of the difference between them: there
 * is no condition on the balance, so zero rows has exactly one meaning and needs no
 * follow-up query to interpret. It is still an `update … where account_number = $1` rather
 * than a read and a write, for the same reason — the sum is computed from the row inside the
 * database, so two concurrent deposits cannot lose one another.
 */
export const credit = async (
  db: Kysely<Database>,
  accountNumber: string,
  amount: Pennies,
): Promise<BalanceChange> => {
  const credited = await db
    .updateTable('accounts')
    .set((eb) => ({ balance: eb('balance', '+', amount) }))
    .where('account_number', '=', accountNumber)
    .returning('balance')
    .executeTakeFirst()

  return credited === undefined ? 'accountGone' : 'applied'
}

const exists = async (db: Kysely<Database>, accountNumber: string): Promise<boolean> =>
  (await db
    .selectFrom('accounts')
    .select('account_number')
    .where('account_number', '=', accountNumber)
    .executeTakeFirst()) !== undefined

export const accountsRepository = (db: Kysely<Database>): AccountsRepository => ({
  create_accountRzA: (account) =>
    ResultAsync.fromPromise(insertAccount(db, account), unexpected).map(toAccountRecord),

  /**
   * `undefined` for a missing row, and the owner comes back on the record rather than being
   * filtered in the query. Adding `where('user_id', '=', …)` here would make a foreign
   * account indistinguishable from an absent one, which is a 404 where the specification
   * says 403 — the authorisation decision needs the row in order to be made at all.
   */
  find_accountByNumberRzA: (accountNumber) =>
    ResultAsync.fromPromise(
      db
        .selectFrom('accounts')
        .selectAll()
        .where('account_number', '=', accountNumber)
        .executeTakeFirst(),
      unexpected,
    ).map((row) => (row === undefined ? undefined : toAccountRecord(row))),
})
