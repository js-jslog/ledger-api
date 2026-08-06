import { Kysely, sql } from 'kysely'

/**
 * The first domain table.
 *
 * `email` is unique on `lower(email)` rather than on the raw column. Two rows differing
 * only in case are two accounts for one human, and the duplicate is invisible to
 * everything that looks the address up. The index carries a name because the service
 * distinguishes this violation from every other `23505` by that name — see
 * `src/repo/users.ts`.
 *
 * `updated_at` is maintained by the trigger below and never by application code. The
 * trigger function is deliberately not named for this table: every table carrying an
 * `updated_at` reuses it.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('address_line1', 'text', (col) => col.notNull())
    .addColumn('address_line2', 'text')
    .addColumn('address_line3', 'text')
    .addColumn('address_town', 'text', (col) => col.notNull())
    .addColumn('address_county', 'text', (col) => col.notNull())
    .addColumn('address_postcode', 'text', (col) => col.notNull())
    .addColumn('phone_number', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('users_email_lower_key')
    .on('users')
    .unique()
    .expression(sql`lower(email)`)
    .execute()

  await sql`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$
  `.execute(db)

  await sql`
    create trigger users_set_updated_at
    before update on users
    for each row execute function set_updated_at()
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('users').execute()
  await sql`drop function set_updated_at`.execute(db)
}
