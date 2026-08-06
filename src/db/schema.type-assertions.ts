/**
 * A test enforced by `pnpm typecheck` rather than by the test runner, for the same
 * reason as the other three: everything below is decided before the program exists.
 *
 * WHAT IT STANDS AGAINST. Two declarations in `schema.ts` carry a guarantee that nothing
 * at runtime can report on. `DatabaseMaintained` is the whole of "`updatedTimestamp` is
 * maintained by a database trigger, never by application code", and the `never` update
 * position on every `transactions` column is the whole of "transactions are append-only" at
 * this layer. Neither has a runtime symptom: an application write to `updated_at` would
 * simply be overwritten by the trigger, and an amended transaction would succeed quietly.
 * The suite would stay green while the types had stopped saying anything. Each
 * `@ts-expect-error` fails the build if the error it names stops being produced.
 *
 * The insert case is here for a second reason. `never` in the insert position reads as
 * though it should make the column impossible to satisfy and therefore make the table
 * impossible to insert into at all — it does not, and that was checked rather than
 * assumed. See docs/divergences.md § Slice 2.
 */
import type { Kysely } from 'kysely'

import type { Pennies } from '../domain/money.js'
import type { Database } from './schema.js'

const row = {
  id: 'usr-0123456789abcdef',
  name: 'Test User',
  address_line1: '1 Test Street',
  address_line2: null,
  address_line3: null,
  address_town: 'Testville',
  address_county: 'Testshire',
  address_postcode: 'TE1 1ST',
  phone_number: '+441234567890',
  email: 'test@example.com',
  password_hash: 'not-a-real-hash',
}

// ── The insert that has to work ──────────────────────────────────────────────────
// Omitting both timestamps is the ordinary case, and it is what lets the column
// defaults apply.

export const insertOmittingTimestamps = async (db: Kysely<Database>): Promise<void> => {
  await db.insertInto('users').values(row).execute()
}

// ── Setting a trigger-maintained column on insert ────────────────────────────────

export const insertSupplyingCreatedAt = async (db: Kysely<Database>): Promise<void> => {
  // @ts-expect-error -- created_at is the trigger's column, not the application's.
  await db.insertInto('users').values({ ...row, created_at: new Date() }).execute()
}

// ── Racing the trigger on update ─────────────────────────────────────────────────
// The case section 3 names. Without the `never` this compiles, runs, and is silently
// undone by the trigger.

export const updateSettingUpdatedAt = async (db: Kysely<Database>): Promise<void> => {
  // @ts-expect-error -- updated_at is maintained by users_set_updated_at.
  await db.updateTable('users').set({ updated_at: new Date() }).execute()
}

// ── Amending a transaction ───────────────────────────────────────────────────────
// Section 3 requires that transactions be append-only at every layer, and this is the
// layer with no runtime symptom: there is no update path to test, so a `never` that
// stopped saying anything would leave the suite green and the guarantee gone. `reference`
// is the column chosen because it is the only nullable one and therefore the one an
// amendment would plausibly reach for.

const transaction = {
  id: 'tan-0123456789abcdef',
  account_number: '01234567',
  user_id: 'usr-0123456789abcdef',
  amount: 1099 as Pennies,
  type: 'deposit',
  reference: null,
}

export const insertTransaction = async (db: Kysely<Database>): Promise<void> => {
  await db.insertInto('transactions').values(transaction).execute()
}

export const updateAmendingATransaction = async (db: Kysely<Database>): Promise<void> => {
  // @ts-expect-error -- transactions are append-only; there is no update position to set.
  await db.updateTable('transactions').set({ reference: 'amended' }).execute()
}
