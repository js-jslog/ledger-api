import type { ColumnType, Generated } from 'kysely'

/**
 * The Kysely database interface. This is the type declaration §4 warns can
 * become "a lie that `strict: true` cannot catch" if the column type and the
 * driver's parsed representation disagree.
 */

/**
 * Timestamps are written by the database and never by the application: `never`
 * in both the insert and update positions.
 *
 * This declaration is deliberately strict and it caught something. The spec
 * requires `createdTimestamp` and `updatedTimestamp` on every account and user
 * response, and every mutating endpoint has to move `updatedTimestamp` — but the
 * brief never says who maintains them. Writing `updated_at: new Date()` inside
 * the repository is the obvious answer and this type rejects it, which is the
 * right outcome: an app-maintained `updated_at` is one every future write path
 * can forget, and forgetting is silent. Migration 001 installs a trigger
 * instead, so the guarantee holds for writes nobody has thought of yet.
 */
type Timestamp = ColumnType<Date, never, never>

export type UserTable = {
  id: string // usr-<nanoid>, minted by the application to match ^usr-[A-Za-z0-9]+$
  name: string
  email: string // UNIQUE -- see §6, the 409 created by adding a password field
  password_hash: string
  address_line1: string
  address_line2: string | null
  address_line3: string | null
  address_town: string
  address_county: string
  address_postcode: string
  phone_number: string
  created_at: Timestamp
  updated_at: Timestamp
}

export type AccountTable = {
  /** ^01\d{6}$ -- the account number IS the primary key, per the spec's paths. */
  account_number: string
  user_id: string
  name: string
  account_type: 'personal'
  /**
   * Money as integer pennies in an int4 column (§4). int4 holds £21.4m in
   * pennies against a spec that caps accounts at £10,000, and node-postgres
   * parses int4 as a native `number` with no configuration -- whereas int8 comes
   * back as a *string*, which is what would make this declaration a lie.
   * Probe 04 verifies both halves of that.
   */
  balance_pennies: number
  currency: 'GBP'
  created_at: Timestamp
  updated_at: Timestamp
}

export type TransactionTable = {
  id: string // tan-<nanoid>
  account_number: string
  /** Append-only (§3). Positive for a deposit, positive for a withdrawal too --
   * direction lives in `type`, so the amount always matches what was requested. */
  amount_pennies: number
  type: 'deposit' | 'withdrawal'
  currency: 'GBP'
  reference: string | null
  /** Balance after this transaction. Makes the ledger auditable without a sum. */
  balance_after_pennies: number
  created_at: Timestamp
}

/** A table used only to demonstrate int4 vs int8 driver parsing. */
export type WidthProbeTable = {
  id: Generated<number>
  as_int4: number
  as_int8: number
  as_numeric: number
}

export type Database = {
  users: UserTable
  accounts: AccountTable
  transactions: TransactionTable
  width_probe: WidthProbeTable
}
