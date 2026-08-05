import type { ColumnType } from 'kysely'

/**
 * The Kysely database interface. Each table arrives with the step that reads it,
 * alongside its own migration, because the migrations are where the money
 * representation and the trigger-maintained timestamps are actually settled — and
 * those are domain decisions rather than plumbing.
 */
export type Database = {
  users: UsersTable
}

/**
 * `never` in both write positions. The column is maintained by a database trigger, so
 * the type's job is to make an application-side write a compile error rather than a
 * race against the trigger that owns it — and the same declaration still leaves the
 * column omittable on insert, which is what lets the default apply.
 */
type TriggerMaintained = ColumnType<Date, never, never>

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
  created_at: TriggerMaintained
  updated_at: TriggerMaintained
}
