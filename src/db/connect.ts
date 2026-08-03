import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { DB } from './types.js'

/**
 * PROBE 03 fix: int8 (OID 20) is returned as a string by node-postgres. Every
 * money column is BIGINT, so without this the hand-written column types are a lie.
 * Global and process-wide, so it belongs at the composition root and nowhere else.
 */
export const installInt8Parser = (): void => {
  pg.types.setTypeParser(20, (raw: string) => {
    const n = Number(raw)
    if (!Number.isSafeInteger(n)) {
      throw new Error(`int8 value ${raw} is not a safe JS integer`)
    }
    return n
  })
}

export const connect = (connectionString: string): Kysely<DB> => {
  installInt8Parser()
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 20 }) }),
  })
}
