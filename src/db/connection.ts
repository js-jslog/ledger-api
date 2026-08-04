import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

import type { Database } from './schema.js'

/**
 * The connection strings are defaults in code with environment overrides, rather
 * than values read from a `.env` file.
 *
 * `.env` is in `.gitignore`, so a connection string living only there is a string a
 * fresh clone does not have. The reviewer's first command is `docker compose up -d
 * --wait` followed by `pnpm test`, and both have to work with nothing configured —
 * which means the working value has to be committed somewhere. Committing it here
 * rather than in a `.env.example` keeps it in one place: an example file would be a
 * second copy of the same string, and two copies can disagree.
 *
 * The defaults match `compose.yml` and are useful on a developer machine only. A
 * deployed process is handed the whole string in `DATABASE_URL` and never assembles
 * one from parts, so there is no host, port or credential to configure separately —
 * and therefore no half-configured state where three of four parts come from the
 * environment.
 */
const DEFAULT_SERVER = 'postgres://ledger:ledger@localhost:55432'

export const DEFAULT_DATABASE_URL = `${DEFAULT_SERVER}/ledger`
export const DEFAULT_TEST_DATABASE_URL = `${DEFAULT_SERVER}/ledger_test`

export const databaseUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL

export const testDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL

/**
 * Takes the connection string rather than reading it, so a caller cannot connect to
 * one database while having checked another. The destructive reset helper depends on
 * that: it asserts a name and then connects with the same string it asserted.
 *
 * Every caller owns the returned handle and must `destroy()` it. Under
 * `isolate: true` each test file builds its own pool, and a pool left open holds the
 * vitest process past the end of the run — which presents as a suite that passes and
 * then hangs, with nothing naming the cause. R12.
 */
export const connect = (connectionString: string): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  })
