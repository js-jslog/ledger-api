import { sql, type Kysely } from 'kysely'

import type { Database } from '../../src/db/schema.js'

/**
 * Per-test isolation, called from a `beforeEach` by every file that writes. The schema
 * is reset and migrated once per run, so without this a file inherits whatever rows the
 * files before it left — and, more sharply, a test inherits the rows left by the test
 * before it in its own file. The unique email constraint turns that into a duplicate
 * where the test meant to create a user. R31.
 *
 * `cascade` because the later tables reference this one. `restart identity` is what R31
 * prescribed and is deliberately absent: no table in this design has an identity column,
 * since every id is minted in application code.
 */
export const truncateAll = async (db: Kysely<Database>): Promise<void> => {
  await sql`truncate table users cascade`.execute(db)
}
