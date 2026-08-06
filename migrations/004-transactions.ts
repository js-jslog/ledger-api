import { Kysely, sql } from 'kysely'

/**
 * The append-only table, and the absences are the design rather than an unfinished
 * version of one.
 *
 * THERE IS NO `updated_at` AND NO TRIGGER. Every other table in this schema carries both.
 * A transaction is a record of something that happened, so there is no state for a second
 * timestamp to describe — and the column's absence is what makes "transactions are never
 * modified" a property of the schema rather than a promise about the code. `src/db/schema.ts`
 * carries the other half, declaring `never` in the update position for every column so that
 * an update is a compile error before it is a missing timestamp.
 *
 * `amount` is an `integer` count of pennies for the reason `003-accounts.ts` gives for
 * `balance`, and it is the same decision rather than a second one: `bigint` and `numeric`
 * both come back from the driver as strings.
 *
 * `user_id` is stored rather than derived. Only an account's owner can transact on it
 * today, so the column is redundant with `accounts.user_id` — but it records who acted at
 * the time, which stops being derivable the moment anyone other than the owner can act on
 * an account, and this table is the one place in the schema where a fact cannot be
 * backfilled afterwards.
 *
 * `type` carries no check constraint, for the reason `account_type` does not: the ingress
 * enum is the enforcement, and a second copy in the schema is a second thing to update when
 * a type is added.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('transactions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('account_number', 'text', (col) =>
      col.notNull().references('accounts.account_number'),
    )
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id'))
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('reference', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('transactions').execute()
}
