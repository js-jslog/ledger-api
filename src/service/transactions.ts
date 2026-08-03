import { err, ok, type Result } from 'neverthrow'
import type { Kysely } from 'kysely'
import type { Database } from '../db/schema.js'
import { notFound, validationFailed, type DomainError } from '../domain/errors.js'
import { toDecimal, toPennies } from '../domain/money.js'
import type { CreateTransactionBody } from '../http/schemas.js'
import { makeAccountRepo, type AccountRepo } from '../repo/accounts.js'
import { randomBytes } from 'node:crypto'

export type TransactionResponse = {
  id: string
  amount: number
  currency: 'GBP'
  type: 'deposit' | 'withdrawal'
  reference?: string
  userId?: string
  createdTimestamp: string
}

/** ^tan-[A-Za-z0-9]+$ -- note the spec's own pattern is single-character; see §6. */
function newTransactionId(): string {
  return `tan-${randomBytes(8).toString('hex')}`
}

export function makeTransactionService(db: Kysely<Database>) {
  const repo: AccountRepo = makeAccountRepo(db, newTransactionId)

  return {
    /**
     * §7's sequencing: resolve ownership first (keeping 403 and 404 distinct),
     * then post the transaction.
     */
    async create(
      accountNumber: string,
      authUserId: string,
      body: CreateTransactionBody,
    ): Promise<Result<TransactionResponse, DomainError>> {
      // The decimal/pennies boundary. The schema's `currencyScale` keyword has
      // already rejected >2dp, so this conversion cannot fail -- but it returns
      // null rather than throwing, and treating that as a 400 keeps the two
      // layers independent. A schema change cannot turn into a 500 here.
      const amountPennies = toPennies(body.amount)
      if (amountPennies === null || amountPennies <= 0) {
        return err(
          validationFailed([
            { field: 'amount', message: 'must be a positive amount with at most 2dp', type: 'currencyScale' },
          ]),
        )
      }

      const owned = await repo.resolveForOwner(accountNumber, authUserId)
      if (owned.isErr()) return err(owned.error)

      const posted =
        body.type === 'deposit'
          ? await repo.credit(accountNumber, amountPennies, body.reference ?? null)
          : await repo.debitIfSufficient(accountNumber, amountPennies, body.reference ?? null)

      return posted.map((p) => ({
        id: p.transactionId,
        amount: toDecimal(amountPennies),
        currency: 'GBP' as const,
        type: body.type,
        ...(body.reference === undefined ? {} : { reference: body.reference }),
        createdTimestamp: new Date().toISOString(),
      }))
    },

    async list(
      accountNumber: string,
      authUserId: string,
    ): Promise<Result<{ transactions: TransactionResponse[] }, DomainError>> {
      const owned = await repo.resolveForOwner(accountNumber, authUserId)
      if (owned.isErr()) return err(owned.error)

      const rows = await db
        .selectFrom('transactions')
        .selectAll()
        .where('account_number', '=', accountNumber)
        .orderBy('created_at', 'asc')
        .execute()

      return ok({
        transactions: rows.map((r) => ({
          id: r.id,
          amount: toDecimal(r.amount_pennies),
          currency: r.currency,
          type: r.type,
          ...(r.reference === null ? {} : { reference: r.reference }),
          createdTimestamp: r.created_at.toISOString(),
        })),
      })
    },

    /**
     * §6 P7: "`TransactionResponse` has no `accountId`, so the 'transaction
     * belongs to a different account you own -> 404' scenario cannot be enforced
     * by fetch-then-compare and must be scoped in the query."
     *
     * Confirmed as the right shape, and note the second `where` is the whole
     * mechanism -- without it, a transaction id belonging to another of the
     * user's own accounts would be returned under the wrong account number, and
     * the response body contains nothing that would reveal the mistake.
     */
    async fetch(
      accountNumber: string,
      transactionId: string,
      authUserId: string,
    ): Promise<Result<TransactionResponse, DomainError>> {
      const owned = await repo.resolveForOwner(accountNumber, authUserId)
      if (owned.isErr()) return err(owned.error)

      const row = await db
        .selectFrom('transactions')
        .selectAll()
        .where('id', '=', transactionId)
        .where('account_number', '=', accountNumber) // <- scoped, not compared
        .executeTakeFirst()

      if (row === undefined) return err(notFound('Transaction'))

      return ok({
        id: row.id,
        amount: toDecimal(row.amount_pennies),
        currency: row.currency,
        type: row.type,
        ...(row.reference === null ? {} : { reference: row.reference }),
        createdTimestamp: row.created_at.toISOString(),
      })
    },
  }
}

export type TransactionService = ReturnType<typeof makeTransactionService>
