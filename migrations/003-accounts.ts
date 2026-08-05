import { Kysely, sql } from 'kysely'

/**
 * `account_number` is the primary key rather than a surrogate id, because it is what the
 * published document puts in the path and in every response — a second identifier would
 * exist only to be translated back into this one at every boundary.
 *
 * `balance` is an `integer` count of pennies, and the type is the decision. `bigint` and
 * `numeric` both come back from the driver as strings, which makes the Kysely declaration
 * a lie that `strict: true` cannot catch. The cost is a ceiling of about £21.4m per
 * account, which is stated rather than discovered.
 *
 * There is no opening-balance column value here on purpose: the default owns it, and the
 * Kysely declaration says `never` in the insert position so that application code cannot
 * choose one.
 *
 * `sort_code` and `currency` are absent. Both are single-value enumerations in the
 * specification, and a column that can only ever hold one value is a claim about a future
 * nobody has decided. They are constants in `src/service/accounts.ts`, where the response
 * schema's `enum` is what keeps them honest.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('accounts')
    .addColumn('account_number', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('account_type', 'text', (col) => col.notNull())
    .addColumn('balance', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // The trigger function is created by the users migration and is deliberately not named
  // for a table — every table carrying an `updated_at` reuses it.
  await sql`
    create trigger accounts_set_updated_at
    before update on accounts
    for each row execute function set_updated_at()
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('accounts').execute()
}
