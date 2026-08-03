import type { Kysely } from 'kysely'
import { err, ok, type Result } from 'neverthrow'
import type { AccountRow, Address, DB } from '../db/types.js'
import type { DomainError } from './errors.js'
import { forbidden, notFound } from './errors.js'
import { newAccountNumber, newTransactionId, newUserId } from './ids.js'
import { toPence, toPounds } from './money.js'
import { hashPassword, verifyPassword } from './password.js'
import { issue } from './tokens.js'
import type { Principal } from './tokens.js'

/** A thrown carrier used only to force a Kysely rollback. See PROBE 04. */
class Rollback extends Error {
  constructor(readonly domainError: DomainError) { super('rollback') }
}

const runTx = async <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> => {
  try {
    return await db.transaction().execute(async (trx) => {
      const result = await body(trx as unknown as Kysely<DB>)
      // Kysely rolls back on throw only. Returning err() would COMMIT the partial
      // work — proven in PROBE 04 — so the error is converted to a throw here and
      // converted back below. Every multi-statement operation must go through this.
      if (result.isErr()) throw new Rollback(result.error)
      return result
    })
  } catch (e) {
    if (e instanceof Rollback) return err(e.domainError)
    throw e
  }
}

export interface AccountView {
  accountNumber: string; sortCode: '10-10-10'; name: string; accountType: 'personal'
  balance: number; currency: 'GBP'; createdTimestamp: string; updatedTimestamp: string
}

export const makeService = (db: Kysely<DB>, jwtSecret: string) => ({
  createUser: async (input: {
    name: string; address: Address; phoneNumber: string
    email: string; password: string
  }): Promise<Result<{ id: string }, DomainError>> => {
    const existing = await db.selectFrom('users').select('id')
      .where('email', '=', input.email).executeTakeFirst()
    if (existing) return err({ kind: 'CONFLICT', reason: 'EMAIL_TAKEN' })

    const id = newUserId()
    await db.insertInto('users').values({
      id, name: input.name,
      // JSONB: the column type declares `string` on insert, so this is a compile
      // error if you forget to stringify — which node-postgres would otherwise
      // silently store as the literal text "[object Object]".
      address: JSON.stringify(input.address), phone_number: input.phoneNumber,
      email: input.email, password_hash: await hashPassword(input.password),
    }).execute()
    return ok({ id })
  },

  login: async (email: string, password: string): Promise<Result<{ token: string }, DomainError>> => {
    const user = await db.selectFrom('users').select(['id', 'password_hash'])
      .where('email', '=', email).executeTakeFirst()
    // Same error for unknown email and wrong password: no account-existence oracle
    // on the *unauthenticated* endpoint. Contrast with fetchUser below, where the
    // spec forces one.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return err({ kind: 'UNAUTHENTICATED', reason: 'BAD_CREDENTIALS' })
    }
    return ok({ token: issue(user.id, jwtSecret) })
  },

  fetchUser: async (principal: Principal, userId: string) => {
    const user = await db.selectFrom('users').selectAll()
      .where('id', '=', userId).executeTakeFirst()
    // Ordering is forced by the scenarios: a non-existent id is 404 even when it is
    // not yours, and another user's existing id is 403. So existence must be
    // established before ownership, which makes this endpoint a user-enumeration
    // oracle by specification. Recorded rather than silently "fixed" to 404.
    if (!user) return err(notFound('user'))
    if (user.id !== principal.userId) return err(forbidden('user'))
    return ok(user)
  },

  createAccount: async (
    principal: Principal, input: { name: string; accountType: 'personal' },
  ): Promise<Result<AccountRow, DomainError>> => {
    // Random 6-digit account numbers collide; retry on unique violation. See ids.ts.
    for (let attempt = 0; attempt < 5; attempt++) {
      const accountNumber = newAccountNumber()
      const clash = await db.selectFrom('accounts').select('account_number')
        .where('account_number', '=', accountNumber).executeTakeFirst()
      if (clash) continue
      const row = await db.insertInto('accounts').values({
        account_number: accountNumber, user_id: principal.userId,
        name: input.name, account_type: input.accountType,
      }).returningAll().executeTakeFirstOrThrow()
      return ok(row)
    }
    return err({
      kind: 'INTERNAL',
      detail: 'could not allocate a free account number in 5 attempts',
    })
  },

  fetchAccount: async (principal: Principal, accountNumber: string) => {
    const account = await db.selectFrom('accounts').selectAll()
      .where('account_number', '=', accountNumber).executeTakeFirst()
    if (!account) return err(notFound('account'))
    if (account.user_id !== principal.userId) return err(forbidden('account'))
    return ok(account)
  },

  createTransaction: async (
    principal: Principal, accountNumber: string,
    input: { amount: number; currency: 'GBP'; type: 'deposit' | 'withdrawal'; reference?: string },
  ) => {
    const pence = toPence(input.amount)
    if (pence.isErr()) return err(pence.error)
    const amountPence = pence.value

    return runTx(db, async (trx) => {
      // The ownership check must happen inside the transaction and must lock, or a
      // concurrent DELETE of the account races the insert into transactions and
      // trips the foreign key as a 500 instead of a 404.
      const account = await trx.selectFrom('accounts')
        .select(['user_id', 'balance_pence'])
        .where('account_number', '=', accountNumber)
        .forUpdate()
        .executeTakeFirst()
      if (!account) return err(notFound('account'))
      if (account.user_id !== principal.userId) return err(forbidden('account'))

      if (input.type === 'withdrawal') {
        const updated = await trx.updateTable('accounts')
          .set((eb) => ({
            balance_pence: eb('balance_pence', '-', amountPence),
            updated_timestamp: new Date(),
          }))
          .where('account_number', '=', accountNumber)
          .where('balance_pence', '>=', amountPence)
          .executeTakeFirst()
        if (Number(updated.numUpdatedRows) === 0) {
          return err({
            kind: 'INSUFFICIENT_FUNDS',
            balancePence: account.balance_pence, requestedPence: amountPence,
          })
        }
      } else {
        await trx.updateTable('accounts')
          .set((eb) => ({
            balance_pence: eb('balance_pence', '+', amountPence),
            updated_timestamp: new Date(),
          }))
          .where('account_number', '=', accountNumber)
          .execute()
      }

      const row = await trx.insertInto('transactions').values({
        id: newTransactionId(), account_number: accountNumber, user_id: principal.userId,
        amount_pence: amountPence, currency: input.currency, type: input.type,
        reference: input.reference ?? null,
      }).returningAll().executeTakeFirstOrThrow()
      return ok(row)
    })
  },

  listTransactions: async (principal: Principal, accountNumber: string) => {
    const account = await db.selectFrom('accounts').select('user_id')
      .where('account_number', '=', accountNumber).executeTakeFirst()
    if (!account) return err(notFound('account'))
    if (account.user_id !== principal.userId) return err(forbidden('account'))
    const rows = await db.selectFrom('transactions').selectAll()
      .where('account_number', '=', accountNumber)
      .orderBy('created_timestamp', 'desc').execute()
    return ok(rows)
  },

  currentBalancePence: async (accountNumber: string) =>
    (await db.selectFrom('accounts').select('balance_pence')
      .where('account_number', '=', accountNumber).executeTakeFirstOrThrow()).balance_pence,
})

export const accountView = (row: AccountRow): AccountView => ({
  accountNumber: row.account_number,
  sortCode: '10-10-10',
  name: row.name,
  accountType: row.account_type,
  balance: toPounds(row.balance_pence),
  currency: row.currency,
  createdTimestamp: row.created_timestamp.toISOString(),
  updatedTimestamp: row.updated_timestamp.toISOString(),
})

export type Service = ReturnType<typeof makeService>
