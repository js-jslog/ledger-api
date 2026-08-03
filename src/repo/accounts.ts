import { err, ok, type Result } from 'neverthrow'
import type { Kysely } from 'kysely'
import { forbidden, insufficientFunds, notFound, type DomainError } from '../domain/errors.js'
import type { Database } from '../db/schema.js'

export type PostedTransaction = {
  readonly transactionId: string
  readonly balancePennies: number
}

/**
 * §4's repository port:
 *   debitIfSufficient(accountNumber, amountPennies): Result<NewBalance, InsufficientFunds>
 *   "one method owning BEGIN/COMMIT and the transaction-row insert. Takes no
 *    balance parameter, so the fatal 'reuse the balance from the ownership
 *    resolve' optimisation is not expressible."
 *
 * The signature is the design. There is no `expectedBalance` parameter and no
 * `currentBalance` parameter, so the only way to compute the new balance is from
 * the row itself, inside the database.
 */
export function makeAccountRepo(db: Kysely<Database>, newTransactionId: () => string) {
  return {
    /**
     * The conditional UPDATE from §7, wrapped with the transaction-row insert in
     * one database transaction.
     *
     *   UPDATE accounts SET balance = balance - $1
     *    WHERE account_number = $2 AND balance >= $1
     *   RETURNING balance
     *
     * Correct under READ COMMITTED because the new value is computed from the
     * row's current value *inside* the database. A second transaction touching
     * the same row blocks on the row lock, and when it resumes it re-reads the
     * updated row and re-evaluates `balance >= $1` against the new value rather
     * than its stale snapshot.
     */
    async debitIfSufficient(
      accountNumber: string,
      amountPennies: number,
      reference: string | null,
    ): Promise<Result<PostedTransaction, DomainError>> {
      return db.transaction().execute(async (tx) => {
        const updated = await tx
          .updateTable('accounts')
          // No `updated_at` here: a trigger owns it (see migration 001), and the
          // Kysely column type declares it unwritable so this cannot regress.
          .set((eb) => ({ balance_pennies: eb('balance_pennies', '-', amountPennies) }))
          .where('account_number', '=', accountNumber)
          .where('balance_pennies', '>=', amountPennies)
          .returning('balance_pennies')
          .executeTakeFirst()

        // Zero rows. §7 argues this "can only mean insufficient funds" because
        // the ownership resolve ran first. See probe 04 for the case where that
        // reasoning does not hold.
        if (updated === undefined) return err(insufficientFunds())

        const transactionId = newTransactionId()
        await tx
          .insertInto('transactions')
          .values({
            id: transactionId,
            account_number: accountNumber,
            amount_pennies: amountPennies,
            type: 'withdrawal',
            currency: 'GBP',
            reference,
            balance_after_pennies: updated.balance_pennies,
          })
          .execute()

        return ok({ transactionId, balancePennies: updated.balance_pennies })
      })
    },

    /**
     * The deposit counterpart. §4 names only `debitIfSufficient`; the brief never
     * gives the credit path a port method, even though it has the same atomicity
     * requirement (§3: "The balance update and the transaction insert always
     * occur inside one database transaction").
     *
     * Note the asymmetry that makes this NOT just debit with a negative amount:
     * a credit has no funds condition, so a zero-row result here means the
     * account does not exist, which is a 404 rather than a 422.
     */
    async credit(
      accountNumber: string,
      amountPennies: number,
      reference: string | null,
    ): Promise<Result<PostedTransaction, DomainError>> {
      return db.transaction().execute(async (tx) => {
        const updated = await tx
          .updateTable('accounts')
          .set((eb) => ({ balance_pennies: eb('balance_pennies', '+', amountPennies) }))
          .where('account_number', '=', accountNumber)
          .returning('balance_pennies')
          .executeTakeFirst()

        if (updated === undefined) return err(notFound('Bank account'))

        const transactionId = newTransactionId()
        await tx
          .insertInto('transactions')
          .values({
            id: transactionId,
            account_number: accountNumber,
            amount_pennies: amountPennies,
            type: 'deposit',
            currency: 'GBP',
            reference,
            balance_after_pennies: updated.balance_pennies,
          })
          .execute()

        return ok({ transactionId, balancePennies: updated.balance_pennies })
      })
    },

    /**
     * The ownership resolve that §7 insists stays a separate query, so that 403,
     * 404 and 422 do not collapse into one indistinguishable zero-row result.
     */
    async resolveForOwner(
      accountNumber: string,
      userId: string,
    ): Promise<Result<{ accountNumber: string }, DomainError>> {
      const row = await db
        .selectFrom('accounts')
        .select(['account_number', 'user_id'])
        .where('account_number', '=', accountNumber)
        .executeTakeFirst()

      if (row === undefined) return err(notFound('Bank account'))
      // 403 rather than 404, per the supplied specification (§3).
      // Must go through the constructor now: the correlation-id intersection makes
      // an inline literal unassignable, which is a welcome side effect -- an
      // error built by hand would also be an error that never logged itself.
      if (row.user_id !== userId) return err(forbidden({ accountNumber, userId }))
      return ok({ accountNumber: row.account_number })
    },
  }
}

export type AccountRepo = ReturnType<typeof makeAccountRepo>
