import { Kysely, PostgresDialect } from 'kysely'
// §4: "Migrator moved to a subpath export in 0.29." Verified -- `Migrator` and
// `FileMigrationProvider` are both undefined on the root export in 0.29.4.
import { FileMigrationProvider, Migrator } from 'kysely/migration'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Pool } from 'pg'
import type { Database } from './schema.js'

export function connectionString(): string {
  return process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost:55432/ledger'
}

export function createDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: connectionString() }) }),
  })
}

/**
 * Runs pending migrations.
 *
 * `FileMigrationProvider` needs an absolute path, and under ESM there is no
 * `__dirname` to build one from -- `import.meta.dirname` is the replacement. Get
 * this wrong and the provider silently finds zero migrations and reports success,
 * so the first query fails with "relation does not exist" and the migration
 * runner looks innocent.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dirname, '../../migrations'),
    }),
  })

  const { error, results } = await migrator.migrateToLatest()
  // Kysely types the migration failure as `unknown`, and lint (correctly) objects
  // both to throwing a non-Error and to String()-ing an arbitrary object -- which
  // would render "[object Object]" and lose the actual cause. JSON is the honest
  // fallback for something whose shape is genuinely unknown.
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error(`migration failed: ${JSON.stringify(error)}`)
  }
  // A silent zero-migration run is the failure mode described above, so say so.
  if ((results ?? []).length === 0) {
    const applied = await migrator.getMigrations()
    if (applied.length === 0) throw new Error('no migration files were found')
  }
}
