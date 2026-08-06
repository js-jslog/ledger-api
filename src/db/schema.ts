import type { ColumnType } from 'kysely'

import type { Pennies } from '../domain/money.js'

/**
 * The Kysely database interface. Each table arrives with the step that reads it,
 * alongside its own migration, because the migrations are where the money
 * representation and the trigger-maintained timestamps are actually settled — and
 * those are domain decisions rather than plumbing.
 */
export type Database = {
  users: UsersTable
  accounts: AccountsTable
  transactions: TransactionsTable
}

/**
 * `never` in both write positions. The column is maintained by the database — `created_at`
 * by its default, `updated_at` by a trigger — so the type's job is to make an
 * application-side write a compile error rather than a race against whatever owns the
 * column. The same declaration still leaves the column omittable on insert, which is what
 * lets the default apply.
 *
 * Named for the database rather than for the trigger because `transactions` has no trigger
 * at all and still needs this: the alias says who writes the column, and the answer there
 * is the default.
 */
type DatabaseMaintained = ColumnType<Date, never, never>

/**
 * `never` in the update position and nothing else. Section 3 requires that transactions be
 * append-only at every layer, and this is that requirement at the type layer: every column
 * of `transactions` carries it, so `db.updateTable('transactions').set(…)` cannot name a
 * column to set and does not compile. The migration carries the other half by giving the
 * table no `updated_at` to maintain.
 */
type AppendOnly<T> = ColumnType<T, T, never>

export type UsersTable = {
  id: string
  name: string
  address_line1: string
  address_line2: string | null
  address_line3: string | null
  address_town: string
  address_county: string
  address_postcode: string
  phone_number: string
  email: string
  password_hash: string
  created_at: DatabaseMaintained
  updated_at: DatabaseMaintained
}

export type AccountsTable = {
  account_number: string
  user_id: string
  name: string
  account_type: string
  /**
   * `never` in the insert position because the opening balance belongs to the column
   * default rather than to application code, so choosing one is a compile error rather
   * than a decision made twice. It reads and updates as `Pennies`, which is what keeps
   * "money is an integer count of pennies inside the service boundary" true without a cast
   * at the repository boundary — the column is already the integer that `toPennies`
   * produces.
   */
  balance: ColumnType<Pennies, never, Pennies>
  created_at: DatabaseMaintained
  updated_at: DatabaseMaintained
}

export type TransactionsTable = {
  id: AppendOnly<string>
  account_number: AppendOnly<string>
  user_id: AppendOnly<string>
  amount: AppendOnly<Pennies>
  type: AppendOnly<string>
  reference: AppendOnly<string | null>
  created_at: DatabaseMaintained
}
