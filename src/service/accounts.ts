import { err, ok, type Result } from 'neverthrow'
import type { Kysely } from 'kysely'
import type { Selectable } from 'kysely'
import type { AccountTable, Database } from '../db/schema.js'
import { forbidden, notFound, type DomainError } from '../domain/errors.js'
import { toDecimal } from '../domain/money.js'
import { insertAccountWithNewNumber } from '../repo/account-numbers.js'

export type AccountResponse = {
  accountNumber: string
  sortCode: '10-10-10'
  name: string
  accountType: 'personal'
  balance: number
  currency: 'GBP'
  createdTimestamp: string
  updatedTimestamp: string
}

/** The spec fixes sortCode to a single enum value, so it is a constant, not a column. */
const SORT_CODE = '10-10-10' as const

/**
 * `Selectable<AccountTable>`, not `AccountTable`.
 *
 * The table type declares timestamps as `ColumnType<Date, never, never>`, which
 * is a branded type carrying separate select/insert/update views. Writing
 * `AccountTable & { created_at: Date }` does NOT override it -- the intersection
 * keeps the brand and nothing satisfies both halves, so every call site fails
 * with "Date is missing the following properties: __select__, __insert__,
 * __update__". Selectable/Insertable/Updateable are the three projections.
 */
function toResponse(row: Selectable<AccountTable>): AccountResponse {
  return {
    accountNumber: row.account_number,
    sortCode: SORT_CODE,
    name: row.name,
    accountType: row.account_type,
    // The only place a balance becomes a decimal again.
    balance: toDecimal(row.balance_pennies),
    currency: row.currency,
    createdTimestamp: row.created_at.toISOString(),
    updatedTimestamp: row.updated_at.toISOString(),
  }
}

export function makeAccountService(db: Kysely<Database>) {
  return {
    async create(
      userId: string,
      body: { name: string },
    ): Promise<Result<AccountResponse, DomainError>> {
      const allocated = await insertAccountWithNewNumber(db, { userId, name: body.name })
      if (allocated.isErr()) return err(allocated.error)

      const row = await db
        .selectFrom('accounts')
        .selectAll()
        .where('account_number', '=', allocated.value.accountNumber)
        .executeTakeFirstOrThrow()
      return ok(toResponse(row))
    },

    /** Scoped to the authenticated user: there is no "all accounts" query to misuse. */
    async list(userId: string): Promise<Result<{ accounts: AccountResponse[] }, DomainError>> {
      const rows = await db
        .selectFrom('accounts')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('created_at', 'asc')
        .execute()
      return ok({ accounts: rows.map(toResponse) })
    },

    /** Same 404-then-403 ordering as the user keystone. */
    async fetch(
      accountNumber: string,
      authUserId: string,
    ): Promise<Result<AccountResponse, DomainError>> {
      const row = await db
        .selectFrom('accounts')
        .selectAll()
        .where('account_number', '=', accountNumber)
        .executeTakeFirst()

      if (row === undefined) return err(notFound('Bank account'))
      if (row.user_id !== authUserId) return err(forbidden())
      return ok(toResponse(row))
    },
  }
}

export type AccountService = ReturnType<typeof makeAccountService>
