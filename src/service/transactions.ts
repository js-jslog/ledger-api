import type { FromSchema } from 'json-schema-to-ts'
import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { insufficientFunds, notFound, type DomainError } from '../domain/errors.js'
import { CURRENCY, toDecimal, toPennies } from '../domain/money.js'
import type { createTransactionSchema } from '../http/schemas.js'
import type { AccountsRepository } from '../repo/accounts.js'
import type {
  RecordedTransaction,
  TransactionRecord,
  TransactionsRepository,
} from '../repo/transactions.js'
import { owned_resourceRz } from './ownership.js'

export type CreateTransactionBody = FromSchema<typeof createTransactionSchema>

export type TransactionResponseBody = {
  readonly id: string
  readonly amount: number
  readonly currency: string
  readonly type: string
  readonly reference?: string
  readonly userId: string
  readonly createdTimestamp: Date
}

export type TransactionsService = {
  readonly record_transactionRzA: (
    authenticatedUserId: string,
    accountNumber: string,
    body: CreateTransactionBody,
  ) => ResultAsync<TransactionResponseBody, DomainError>
  readonly fetch_transactionRzA: (
    authenticatedUserId: string,
    accountNumber: string,
    transactionId: string,
  ) => ResultAsync<TransactionResponseBody, DomainError>
}

/** The noun both endpoints resolve first, and the wording the specification's 404 uses. */
const ACCOUNT = 'Bank account'

const toResponse = (transaction: TransactionRecord): TransactionResponseBody => ({
  id: transaction.id,
  amount: toDecimal(transaction.amount),
  currency: CURRENCY,
  type: transaction.type,
  // Absent rather than `null` when there was none: the published schema types it as a
  // string, and `JSON.stringify` drops an undefined value rather than sending a key the
  // egress check would reject.
  ...(transaction.reference === null ? {} : { reference: transaction.reference }),
  userId: transaction.userId,
  createdTimestamp: transaction.createdAt,
})

/**
 * THE STATUS TAXONOMY, IN ONE PLACE. The repository reports what the balance change did and
 * this decides what each outcome is worth, which is the same division the walkthrough
 * describes for every other endpoint — and it matters more here than anywhere else in the
 * service, because rev 3 of the design got this exact mapping wrong.
 *
 * `accountGone` is 404 and not 422. A zero-row conditional update means "no row matched",
 * and the ownership resolve that ran a moment earlier was a separate statement on a separate
 * connection — so the row may simply have stopped existing. Reporting insufficient funds for
 * an account that does not exist is the misreport R1 catalogues, and the existence check in
 * `debitIfSufficient` is what makes this branch reachable and correct.
 */
const statusFor = (recorded: RecordedTransaction): Result<TransactionRecord, DomainError> => {
  switch (recorded.outcome) {
    case 'recorded':
      return ok(recorded.transaction)
    case 'insufficientFunds':
      return err(insufficientFunds())
    case 'accountGone':
      return err(notFound(`${ACCOUNT} was not found`))
  }
}

export const transactionsService = (
  accounts: AccountsRepository,
  transactions: TransactionsRepository,
): TransactionsService => {
  /**
   * The third call site of the ownership decision, and the one that shows why it is a
   * function. Both endpoints below reach an account by a number the client put in the path,
   * so both owe the same 404-then-403 answer — and neither of them is about accounts, which
   * is exactly the situation in which a copied pattern gets copied slightly wrong.
   */
  const authorised_accountRzA = (
    authenticatedUserId: string,
    accountNumber: string,
  ): ResultAsync<unknown, DomainError> =>
    accounts
      .find_accountByNumberRzA(accountNumber)
      .andThen((account) =>
        owned_resourceRz(account, (found) => found.userId, authenticatedUserId, ACCOUNT),
      )

  return {
    /**
     * `toPennies` first, so an amount with three decimal places is a 400 before the service
     * has looked anything up. It is also the only conversion into the service boundary: the
     * repository, the column and the arithmetic below it are integers the whole way.
     */
    record_transactionRzA: (authenticatedUserId, accountNumber, body) =>
      toPennies(body.amount)
        .asyncAndThen((amount) =>
          authorised_accountRzA(authenticatedUserId, accountNumber).andThen(() =>
            transactions.record_transactionRzA({
              accountNumber,
              userId: authenticatedUserId,
              amount,
              type: body.type,
              reference: body.reference,
            }),
          ),
        )
        .andThen(statusFor)
        .map(toResponse),

    /**
     * Two lookups and two different 404s. The account is resolved first because a transaction
     * on somebody else's account owes 403 rather than 404 — asking for the transaction first
     * would answer "not found" for an account the caller may not read, which is the right
     * status for the wrong reason and the wrong status for the case the requirements name.
     *
     * The second 404 covers two scenarios at once: a transaction id that exists nowhere, and
     * one that exists against a different account. The requirements give both the same status
     * and `find_transactionRzA` merges them by filtering on both halves of the path.
     */
    fetch_transactionRzA: (authenticatedUserId, accountNumber, transactionId) =>
      authorised_accountRzA(authenticatedUserId, accountNumber)
        .andThen(() => transactions.find_transactionRzA(accountNumber, transactionId))
        .andThen((transaction) =>
          transaction === undefined
            ? err(notFound('Transaction was not found'))
            : ok(transaction),
        )
        .map(toResponse),
  }
}
