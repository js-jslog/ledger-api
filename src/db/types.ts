import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

/**
 * FINDING: the obvious hand-written interface (`balance_pence: number`) does not
 * compile for INSERT — Kysely demands every column unless defaulted columns are
 * wrapped in `Generated<T>`, and demands `Date` for timestamps on insert while
 * returning `Date` on select. Writing the naive version and then reaching for
 * `as never` to make inserts compile is the failure mode: it silences exactly the
 * checks the stack was chosen for. `Generated` and `ColumnType` are the real fix.
 *
 * Note also that these types are an *assertion* about the SQL schema, not a
 * derivation from it. Nothing checks them against schema.sql — see NOTES.md.
 */

export interface Address {
  line1: string
  line2?: string
  line3?: string
  town: string
  county: string
  postcode: string
}

/** Written as a Date, read back as a Date, defaulted by the database. */
type Timestamp = ColumnType<Date, Date | undefined, Date>

export interface UsersTable {
  id: string
  name: string
  /** JSONB: Kysely will not stringify an object for you unless the type says so. */
  address: ColumnType<Address, string, string>
  phone_number: string
  email: string
  password_hash: string
  created_timestamp: Timestamp
  updated_timestamp: Timestamp
}

export interface AccountsTable {
  account_number: string
  user_id: string
  name: string
  account_type: 'personal'
  balance_pence: Generated<number>
  currency: Generated<'GBP'>
  created_timestamp: Timestamp
  updated_timestamp: Timestamp
}

export interface TransactionsTable {
  id: string
  account_number: string
  user_id: string
  amount_pence: number
  currency: Generated<'GBP'>
  type: 'deposit' | 'withdrawal'
  reference: string | null
  created_timestamp: Timestamp
}

export interface DB {
  users: UsersTable
  accounts: AccountsTable
  transactions: TransactionsTable
}

export type UserRow = Selectable<UsersTable>
export type AccountRow = Selectable<AccountsTable>
export type TransactionRow = Selectable<TransactionsTable>
export type NewUser = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>
