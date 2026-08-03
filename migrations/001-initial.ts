import { Kysely, sql } from 'kysely'

/**
 * Kysely migrations receive an untyped Kysely instance: the schema this migration
 * creates does not exist yet, so it cannot be typed against `Database`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // The spec requires `updatedTimestamp` on user and account responses, and every
  // mutating endpoint must move it. Maintaining it in the repository means every
  // future write path has to remember, and forgetting is silent. A trigger makes
  // it unforgettable, and lets the Kysely column type declare `never` for both
  // insert and update -- so the type system enforces that the app does not try.
  await sql`
    create or replace function set_updated_at() returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql
  `.execute(db)

  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    // The unique constraint that turns duplicate signup into a real path.
    // §6: "email becomes the login identifier, so duplicate signup is now a real
    // path with no defined status. Add a unique constraint and a 409."
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('address_line1', 'text', (c) => c.notNull())
    .addColumn('address_line2', 'text')
    .addColumn('address_line3', 'text')
    .addColumn('address_town', 'text', (c) => c.notNull())
    .addColumn('address_county', 'text', (c) => c.notNull())
    .addColumn('address_postcode', 'text', (c) => c.notNull())
    .addColumn('phone_number', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('accounts')
    .addColumn('account_number', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull().references('users.id'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('account_type', 'text', (c) => c.notNull())
    // int4, not int8 and not numeric. See src/db/schema.ts and ADR 1.
    .addColumn('balance_pennies', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('currency', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // A balance can never go negative. The conditional UPDATE in §7 is what
    // enforces this in practice; the constraint is the backstop that turns a bug
    // in that logic into a failed write rather than a corrupt ledger.
    .addCheckConstraint('accounts_balance_non_negative', sql`balance_pennies >= 0`)
    .addCheckConstraint('accounts_number_format', sql`account_number ~ '^01[0-9]{6}$'`)
    .execute()

  await db.schema.createIndex('accounts_user_id_idx').on('accounts').column('user_id').execute()

  for (const table of ['users', 'accounts']) {
    await sql`
      create trigger ${sql.raw(table)}_set_updated_at
      before update on ${sql.raw(table)}
      for each row execute function set_updated_at()
    `.execute(db)
  }

  await db.schema
    .createTable('transactions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('account_number', 'text', (c) => c.notNull().references('accounts.account_number'))
    .addColumn('amount_pennies', 'integer', (c) => c.notNull())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('currency', 'text', (c) => c.notNull())
    .addColumn('reference', 'text')
    .addColumn('balance_after_pennies', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('transactions_amount_positive', sql`amount_pennies > 0`)
    .addCheckConstraint('transactions_type', sql`type in ('deposit', 'withdrawal')`)
    .execute()

  await db.schema
    .createIndex('transactions_account_number_idx')
    .on('transactions')
    .column('account_number')
    .execute()

  // Exists only so probe 04 can demonstrate what the pg driver hands back for
  // each column width. Not part of the domain.
  await db.schema
    .createTable('width_probe')
    .addColumn('id', 'serial', (c) => c.primaryKey())
    .addColumn('as_int4', 'integer', (c) => c.notNull())
    .addColumn('as_int8', 'bigint', (c) => c.notNull())
    .addColumn('as_numeric', sql`numeric(12,2)`, (c) => c.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop function if exists set_updated_at() cascade`.execute(db)
  await db.schema.dropTable('width_probe').ifExists().execute()
  await db.schema.dropTable('transactions').ifExists().execute()
  await db.schema.dropTable('accounts').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
}
