import type { Kysely, Selectable } from 'kysely'
import { ResultAsync } from 'neverthrow'

import type { Database, TransactionsTable } from '../db/schema.js'
import { unexpected, type DomainError } from '../domain/errors.js'
import { newTransactionId } from '../domain/ids.js'
import type { Pennies } from '../domain/money.js'
import { credit, debitIfSufficient, type BalanceChange } from './accounts.js'

export type TransactionType = 'deposit' | 'withdrawal'

/**
 * No `id` and no `createdAt`: the id is minted below and the timestamp is the column
 * default, so neither is a caller's to choose. `userId` is supplied rather than derived from
 * the account, because it records who acted rather than who owns.
 */
export type NewTransaction = {
  readonly accountNumber: string
  readonly userId: string
  readonly amount: Pennies
  readonly type: TransactionType
  readonly reference?: string | undefined
}

export type TransactionRecord = {
  readonly id: string
  readonly accountNumber: string
  readonly userId: string
  readonly amount: Pennies
  readonly type: string
  readonly reference: string | null
  readonly createdAt: Date
}

/**
 * What happened, and not what it is worth. The two failures are reported rather than
 * converted into errors here because the difference between them — 422 for an account with
 * too little in it, 404 for one that is no longer there — is the decision this endpoint
 * exists to get right, and it belongs where a reader looks for status decisions rather than
 * three files down among the SQL.
 */
export type RecordedTransaction =
  | { readonly outcome: 'recorded'; readonly transaction: TransactionRecord }
  | { readonly outcome: Exclude<BalanceChange, 'applied'> }

export type TransactionsRepository = {
  readonly record_transactionRzA: (
    transaction: NewTransaction,
  ) => ResultAsync<RecordedTransaction, DomainError>
  readonly find_transactionRzA: (
    accountNumber: string,
    transactionId: string,
  ) => ResultAsync<TransactionRecord | undefined, DomainError>
}

const toTransactionRecord = (row: Selectable<TransactionsTable>): TransactionRecord => ({
  id: row.id,
  accountNumber: row.account_number,
  userId: row.user_id,
  amount: row.amount,
  type: row.type,
  reference: row.reference,
  createdAt: row.created_at,
})

/**
 * THE TRANSACTION BOUNDARY. Section 3 requires the balance update and the transaction insert
 * to occur inside one database transaction, and this function is the only place either
 * happens — so a balance that moved without a ledger row is not a bug to avoid but a program
 * that cannot be written. That is also why neither `debitIfSufficient` nor `credit` is on the
 * `AccountsRepository` port: a service that could reach them could move money and record
 * nothing.
 *
 * The failure paths return before the insert and the enclosing transaction commits having
 * changed nothing, which is the same outcome as a rollback and one fewer thing to explain. On
 * the withdrawal's path the conditional update has already matched zero rows by then, so
 * there is nothing to undo.
 *
 * The deposit and the withdrawal differ in exactly one expression. Writing them as two
 * methods would duplicate the boundary — the part that has to be right — in order to avoid a
 * ternary in the part that is obvious.
 */
const record = (db: Kysely<Database>, transaction: NewTransaction): Promise<RecordedTransaction> =>
  db.transaction().execute(async (trx): Promise<RecordedTransaction> => {
    const change: BalanceChange =
      transaction.type === 'withdrawal'
        ? await debitIfSufficient(trx, transaction.accountNumber, transaction.amount)
        : await credit(trx, transaction.accountNumber, transaction.amount)

    if (change !== 'applied') return { outcome: change }

    const row = await trx
      .insertInto('transactions')
      .values({
        id: newTransactionId(),
        account_number: transaction.accountNumber,
        user_id: transaction.userId,
        amount: transaction.amount,
        type: transaction.type,
        reference: transaction.reference ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return { outcome: 'recorded', transaction: toTransactionRecord(row) }
  })

export const transactionsRepository = (db: Kysely<Database>): TransactionsRepository => ({
  record_transactionRzA: (transaction) =>
    ResultAsync.fromPromise(record(db, transaction), unexpected),

  /**
   * Filtered by BOTH halves of the path, which looks like the mistake `find_accountByNumberRzA`
   * warns against and is the opposite of it. There, filtering by owner would collapse a
   * foreign account into an absent one and answer 404 where the specification says 403 — the
   * two cases have different statuses, so the query cannot be allowed to merge them. Here the
   * requirements give a transaction that does not exist and a transaction belonging to
   * another account the same status, 404, so merging them is what the specification asks for
   * — and it means this service never has to hold another account's transaction in order to
   * decide not to mention it.
   */
  find_transactionRzA: (accountNumber, transactionId) =>
    ResultAsync.fromPromise(
      db
        .selectFrom('transactions')
        .selectAll()
        .where('id', '=', transactionId)
        .where('account_number', '=', accountNumber)
        .executeTakeFirst(),
      unexpected,
    ).map((row) => (row === undefined ? undefined : toTransactionRecord(row))),
})
