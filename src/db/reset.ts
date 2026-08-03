import { sql, type Kysely } from 'kysely'
import type { Database } from './schema.js'

/**
 * Test-suite database lifecycle.
 *
 * Probe 04 turned up a hazard worth designing against rather than hoping about
 * (FINDINGS.md F9): the `postgres` image declares
 * `VOLUME /var/lib/postgresql/data`, so a compose file with no `volumes:` stanza
 * still gets an *anonymous* volume — and compose carries that volume across
 * container recreation. A container created fresh was observed attached to a
 * volume five hours older than itself, holding another run's tables. The
 * dangerous shape is a schema that exists while `kysely_migration` is empty:
 * `migrateToLatest` then replays migration 001 and dies with
 * `relation "users" already exists`, which reads as a broken migration rather
 * than a dirty volume.
 *
 * So the suite does not trust the database it is handed.
 */

/**
 * Drops and recreates the public schema, then migrates. Cheap (tens of
 * milliseconds) and makes a run reproducible regardless of what the volume was
 * carrying, including a drifted migration ledger.
 */
export async function resetSchema(db: Kysely<Database>): Promise<void> {
  await sql`drop schema public cascade`.execute(db)
  await sql`create schema public`.execute(db)
}

/**
 * Between-test isolation (§4's "truncate between tests"). Faster than a schema
 * rebuild because it leaves the DDL in place.
 *
 * `restart identity` resets sequences so ids do not drift between tests, and
 * `cascade` is required because transactions references accounts references
 * users — without it Postgres refuses with a foreign-key complaint that names a
 * table you did not mention.
 */
export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`
    truncate table transactions, accounts, users, width_probe
    restart identity cascade
  `.execute(db)
}
