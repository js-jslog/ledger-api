import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'

/**
 * §4's money decision rests on two factual claims about the driver:
 *   "int4 ... node-postgres parses it as a native `number` with no configuration.
 *    **int8 returns a string**, which would make the Kysely type declaration a
 *    lie that `strict: true` cannot catch. **[verified]**"
 * and the ADR-1 note: "`sum(integer)` returns bigint in Postgres, so any future
 * derived-balance or reconciliation query comes back as a string even with int4
 * columns."
 */

let db: Kysely<Database>

beforeAll(async () => {
  db = createDb()
  // Do not trust the volume -- see src/db/reset.ts and FINDINGS.md F9.
  await resetSchema(db)
  await migrateToLatest(db)
})

afterAll(async () => {
  await db.destroy()
})

describe('driver parsing by column width', () => {
  test('int4 is a number, int8 and numeric are strings', async () => {
    await db
      .insertInto('width_probe')
      .values({ as_int4: 1099, as_int8: 1099, as_numeric: 10.99 })
      .execute()

    const row = await db.selectFrom('width_probe').selectAll().executeTakeFirstOrThrow()

    // The whole basis of choosing int4.
    expect(typeof row.as_int4).toBe('number')
    expect(row.as_int4).toBe(1099)

    // §4's reason for rejecting int8. The Kysely declaration says `number`;
    // the driver hands back a string, and nothing in the type system notices.
    expect(typeof row.as_int8).toBe('string')

    // NUMERIC has the same problem, which is §4's reason for rejecting it too.
    expect(typeof row.as_numeric).toBe('string')
  })

  test('the type declaration really is a lie that tsc cannot catch', async () => {
    const row = await db.selectFrom('width_probe').selectAll().executeTakeFirstOrThrow()
    // `row.as_int8` is typed `number`. Arithmetic on it therefore compiles
    // cleanly and produces string concatenation at runtime. This is the concrete
    // harm §4 is avoiding, and it is worth having the demonstration to hand.
    const wrong = row.as_int8 + 1
    expect(wrong as unknown as string).toBe('10991') // not 1100
  })

  test('ADR-1 note confirmed: sum(integer) comes back as a string', async () => {
    const result = await sql<{ total: number }>`
      select sum(as_int4) as total from width_probe
    `.execute(db)
    const total = result.rows[0]?.total
    expect(typeof total).toBe('string') // declared number, actually string
  })

  test('int4 has the headroom §4 claims, and the ceiling is enforced', async () => {
    // 2^31-1 pennies = £21,474,836.47 against a spec cap of £10,000.
    const maxInt4 = 2_147_483_647
    expect(maxInt4 / 100).toBeCloseTo(21_474_836.47, 2)

    // And overflow is a hard database error, not a silent wrap.
    await expect(
      db
        .insertInto('width_probe')
        .values({ as_int4: maxInt4 + 1, as_int8: 1, as_numeric: 1 })
        .execute(),
    ).rejects.toThrow(/out of range/i)
  })
})
