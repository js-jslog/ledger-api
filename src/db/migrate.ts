import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Kysely } from 'kysely'
/**
 * `Migrator` and `FileMigrationProvider` are on this subpath ONLY. Both are
 * `undefined` on the root `kysely` export, so the import every tutorial and every
 * model completion suggests fails at runtime rather than at compile time — and it
 * fails as "Migrator is not a constructor", which does not name the cause.
 *
 * Checked here rather than taken on trust, at kysely 0.29.4: both are `undefined` on
 * the root export and functions on this one.
 */
import { FileMigrationProvider, Migrator, type MigrationResult } from 'kysely/migration'

import type { Database } from './schema.js'

/**
 * Resolved from this module's own location rather than from `process.cwd()`, which
 * differs between a test run, a script and a deployed process.
 */
export const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '../../migrations')

export const migratorFor = (db: Kysely<Database>, migrationFolder = MIGRATIONS_FOLDER): Migrator =>
  new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder }) })

/**
 * Throws rather than returning a `Result`, deliberately, and this is the one place in
 * the codebase where that is the right call.
 *
 * A failed migration is not a domain outcome that some caller might reasonably
 * continue past — it means the schema is not what the code was written against, and
 * everything after it is undefined behaviour. There is no branch to take. The
 * errors-as-values design exists for outcomes a caller has to handle; this is an
 * outcome that has to stop the process.
 *
 * Returns the results so a caller can assert which migrations ran, which is what makes
 * the pipeline testable rather than merely runnable.
 *
 * `migrationFolder` is overridable so that the failure modes of a misdirected migrator
 * can be asserted. Production callers pass nothing.
 */
export const migrateToLatest = async (
  db: Kysely<Database>,
  migrationFolder = MIGRATIONS_FOLDER,
): Promise<MigrationResult[]> => {
  const migrator = migratorFor(db, migrationFolder)

  const { error, results } = await migrator.migrateToLatest()

  // Kysely types the failure as `unknown`, so a non-`Error` is representable. It is
  // attached as `cause` rather than stringified: stringifying an unknown object yields
  // `[object Object]`, and `JSON.stringify` throws outright on a circular one. Either
  // way the only diagnostic is the thing being discarded.
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error('A migration failed', { cause: error })
  }

  // Deliberately no "found no migrations" guard here. One was written, and measurement
  // removed it: every way of pointing the migrator at the wrong place already fails
  // loudly, and the two that could plausibly not are pinned as tests rather than
  // guarded against. See docs/divergences.md § Slice 0d.
  return results ?? []
}
