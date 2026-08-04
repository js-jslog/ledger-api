import type { Kysely } from 'kysely'

/**
 * One trivial migration, proving the pipeline end to end: this file is discovered by
 * `FileMigrationProvider`, applied by `Migrator`, recorded in `kysely_migration`, and
 * the object it creates is then read back through the typed query builder. The test
 * that reads it is `test/db/migration-pipeline.test.ts`.
 *
 * It creates no domain table. Each of those arrives with the step that reads it, so
 * the decisions carried by their columns get reviewed on their own rather than inside
 * a step everybody treats as plumbing. This file goes when the first real migration
 * lands.
 *
 * `Kysely<unknown>` rather than `Kysely<Database>`: a migration must keep working
 * after the schema type has moved on past it, so it deliberately cannot see the
 * current table definitions. Referring to `Database` here would make an old migration
 * fail to compile the moment a table it created is renamed or dropped.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('migration_pipeline_proof')
    .addColumn('note', 'text', (col) => col.notNull())
    .execute()
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('migration_pipeline_proof').execute()
}
