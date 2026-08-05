import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sql } from 'kysely'
import { afterAll, expect, test } from 'vitest'

import { DEFAULT_DATABASE_URL, connect, testDatabaseUrl } from '../../src/db/connection.js'
import { MIGRATIONS_FOLDER, migrateToLatest } from '../../src/db/migrate.js'

import { resetSchema } from './reset.js'

const db = connect(testDatabaseUrl())

// Under `isolate: true` this file owns its own pool, and an open pool holds the vitest
// process open after the last assertion — a suite that passes and then hangs, with
// nothing in the output naming the cause. R12.
afterAll(async () => {
  await db.destroy()
})

// The schema this file reads was reset and migrated once by test/db/global-setup.ts,
// so these assertions are about what the pipeline produced rather than about anything
// this file did.
test('the migrator recorded the migration in its own ledger', async () => {
  const { rows } = await sql<{ name: string }>`
    select name from kysely_migration order by name
  `.execute(db)

  expect(rows.map((row) => row.name)).toEqual(['002-users'])
})

// These two exist to establish that `migrateToLatest` needs no "found no migrations"
// guard of its own. One was written and then deleted, because both ways of pointing the
// migrator at nothing turn out to be loud already. Delete these and the argument for
// the absence becomes an assumption again.
test('a migration folder that does not exist fails loudly, naming the path', async () => {
  await expect(migrateToLatest(db, path.join(MIGRATIONS_FOLDER, 'does-not-exist'))).rejects.toThrow(
    /ENOENT.*does-not-exist/,
  )
})

// The interesting one. Kysely compares its ledger against what the provider offers, so
// a folder that has lost migrations the database has already run is reported as
// corruption — a better diagnostic than a hand-written guard would have produced,
// because it names the missing migration.
test('a migration folder missing already-applied migrations is reported as corruption', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'ledger-api-no-migrations-'))

  try {
    await expect(migrateToLatest(db, empty)).rejects.toThrow(
      /corrupted migrations.*002-users is missing/,
    )
  } finally {
    await rm(empty, { recursive: true })
  }
})

// Not a restatement of the unit test on the guard. That one proves the pure function
// rejects the string; this proves the destructive helper actually consults it, which is
// the property that would break if someone later inlined the drop or added a second
// entry point that skipped the check.
test('the reset helper refuses to drop the development database', async () => {
  await expect(resetSchema(DEFAULT_DATABASE_URL)).rejects.toThrow(/does not end in "_test"/)
})
