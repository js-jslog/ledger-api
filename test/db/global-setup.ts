import { connect, testDatabaseUrl } from '../../src/db/connection.js'
import { migrateToLatest } from '../../src/db/migrate.js'

import { resetSchema } from './reset.js'

/**
 * Runs once in the main vitest process, before any test file: reset the schema, then
 * migrate it. Once per run rather than once per file, because the reset is what makes
 * the starting state known and no test file should be able to pull it out from under
 * another.
 *
 * Reset BEFORE migrating, not after. The state worth defending against is a data
 * volume holding a populated schema alongside an empty migration ledger, where
 * migrating first fails with `relation "..." already exists` — an error that accuses
 * the migration and invites someone to reach for `ifNotExists`, which would silence
 * the symptom and bake in the drift.
 */
export const setup = async (): Promise<void> => {
  const url = testDatabaseUrl()

  await resetSchema(url)

  const db = connect(url)

  try {
    await migrateToLatest(db)
  } finally {
    await db.destroy()
  }
}
