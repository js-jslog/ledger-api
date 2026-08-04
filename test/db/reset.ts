import { sql } from 'kysely'

import { connect } from '../../src/db/connection.js'

import { assertTestDatabase } from './test-database-name.js'

/**
 * Drops and recreates the `public` schema, so a run is reproducible regardless of
 * what the data volume was carrying — including a schema that drifted away from the
 * migration ledger, which is a state the volume can genuinely be left in. Costs tens
 * of milliseconds and removes a whole class of "works on my machine".
 *
 * It opens its own connection from the string it just asserted, rather than accepting
 * a handle. Accepting a handle would let the checked string and the connected
 * database diverge, which is exactly the failure the guard exists to prevent.
 */
export const resetSchema = async (connectionString: string): Promise<void> => {
  assertTestDatabase(connectionString)

  const db = connect(connectionString)

  try {
    await sql`drop schema public cascade`.execute(db)
    await sql`create schema public`.execute(db)
  } finally {
    await db.destroy()
  }
}
