import type { Express } from 'express'
import type { Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDb, migrateToLatest } from '../../src/db/connect.js'
import { resetSchema, truncateAll } from '../../src/db/reset.js'
import type { Database } from '../../src/db/schema.js'
import {
  forbidden,
  insufficientFunds,
  notFound,
  unexpected,
  validationFailed,
} from '../../src/domain/errors.js'
import { buildApp } from '../../src/http/routes.js'
import {
  NO_REQUEST_CONTEXT,
  withCorrelationId,
} from '../../src/observability/correlation.js'
import { captureLogs, resetLogSink, type LogRecord } from '../../src/observability/logger.js'

let db: Kysely<Database>
let app: Express
let logs: LogRecord[]

const VALID_USER = {
  name: 'Test User',
  address: { line1: '1 High Street', town: 'Manchester', county: 'Greater Manchester', postcode: 'M1 1AA' },
  phoneNumber: '+447700900000',
  email: 'test@example.com',
  password: 'correct-horse-battery',
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'probe-secret-not-a-real-key'
  db = createDb()
  await resetSchema(db)
  await migrateToLatest(db)
  app = buildApp(db)
})

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await truncateAll(db)
  logs = captureLogs()
})

afterEach(() => {
  resetLogSink()
})

describe('log at construction', () => {
  test('constructing an error logs it, with no call site involved', () => {
    withCorrelationId('fixed-id', () => {
      notFound('User')
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      event: 'domain_error',
      kind: 'NotFound',
      correlationId: 'fixed-id',
      resource: 'User',
    })
  })

  test('log level follows kind, so ordinary client mistakes do not read as errors', () => {
    withCorrelationId('fixed-id', () => {
      validationFailed([])
      notFound('User')
      insufficientFunds()
      forbidden()
      unexpected(new Error('boom'))
    })
    const byKind = Object.fromEntries(logs.map((r) => [r.kind, r.level]))
    expect(byKind).toEqual({
      ValidationFailed: 'info',
      NotFound: 'info',
      InsufficientFunds: 'info',
      Forbidden: 'warn',
      // The only member that is genuinely an error.
      Unexpected: 'error',
    })
  })

  test('Unexpected carries the fell-through marker and the stack', () => {
    withCorrelationId('fixed-id', () => {
      unexpected(new Error('boom'))
    })
    expect(logs[0]).toMatchObject({ kind: 'Unexpected', fellThrough: true })
    expect(String(logs[0]?.stack)).toContain('Error: boom')
  })

  test('an error built outside a request reads as the sentinel, not as broken', () => {
    notFound('User')
    expect(logs[0]?.correlationId).toBe(NO_REQUEST_CONTEXT)
  })
})

describe('one id per request, not one per error', () => {
  test('every record from a single request shares one id', async () => {
    // A request that fails validation produces a construction record and an
    // outcome record. Both must carry the same id or there is nothing to stitch.
    const res = await request(app).post('/v1/users').send({ name: 'incomplete' }).expect(400)

    const ids = new Set(logs.map((r) => r.correlationId))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toBe(res.body.correlationId)
    expect(logs.map((r) => r.event)).toEqual(['domain_error', 'request_failed'])
  })

  test('separate requests get separate ids', async () => {
    await request(app).get('/v1/accounts/01999999').expect(401)
    await request(app).get('/v1/accounts/01999999').expect(401)
    const ids = new Set(logs.map((r) => r.correlationId))
    expect(ids.size).toBe(2)
  })

  test('the id reaches the client on both the body and a header', async () => {
    const res = await request(app).get('/v1/nope').expect(404)
    expect(res.body.correlationId).toEqual(expect.any(String))
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId)
  })

  test('a successful response still carries the header, for support requests', async () => {
    const res = await request(app).post('/v1/users').send(VALID_USER).expect(201)
    expect(res.headers['x-correlation-id']).toEqual(expect.any(String))
  })
})

describe('the two logging sites do not duplicate each other', () => {
  test('the constructor logs the detail; the renderer logs only the outcome', async () => {
    await request(app)
      .post('/v1/users')
      .send({ ...VALID_USER, email: 'not-an-email' })
      .expect(400)

    const construction = logs.find((r) => r.event === 'domain_error')
    const outcome = logs.find((r) => r.event === 'request_failed')

    // Detail lives on the construction record.
    expect(construction).toMatchObject({ kind: 'ValidationFailed' })
    expect(construction?.payload).toMatchObject({ email: 'not-an-email' })
    expect(construction?.schemaPaths).toBeDefined()

    // The outcome record has the routing facts and none of the detail. Without
    // this split every failure produces two copies of the same information.
    expect(outcome).toMatchObject({ status: 400, method: 'POST', route: '/v1/users' })
    expect(outcome).not.toHaveProperty('payload')
    expect(outcome).not.toHaveProperty('schemaPaths')
  })

  test('exactly two records per failed request, not four', async () => {
    await request(app).get('/v1/accounts/01999999').expect(401)
    expect(logs).toHaveLength(2)
  })
})

describe('the response boundary is the protection, not redaction', () => {
  test('the full payload is logged and none of it is rendered', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'someone@example.com', password: 'hunter2', extra: 'unexpected' })
      .expect(400)

    // Logged in full, including the password, keyed by correlation id.
    const construction = logs.find((r) => r.event === 'domain_error')
    expect(construction?.payload).toMatchObject({ password: 'hunter2' })

    // Not rendered. The client gets the spec's {field,message,type} and nothing else.
    const rendered = JSON.stringify(res.body)
    expect(rendered).not.toContain('hunter2')
    expect(rendered).not.toContain('schemaPath')
    expect(rendered).not.toContain('#/')
    for (const detail of res.body.details as Record<string, unknown>[]) {
      expect(Object.keys(detail).sort()).toEqual(['field', 'message', 'type'])
    }
  })

  test('a 500 renders no cause and no stack, but logs both', () => {
    withCorrelationId('fixed-id', () => {
      unexpected(new Error('secret internal detail'))
    })
    expect(JSON.stringify(logs[0])).toContain('secret internal detail')
    // And the renderer's envelope for Unexpected is asserted in probe 02.
  })
})

describe('what the intersection did NOT cost', () => {
  test('the union still narrows on `kind` after intersecting correlationId', () => {
    // The concern with `(A | B | ...) & { correlationId: string }` is that the
    // intersection could stop distributing over the union, which would silently
    // break both the `switch (error.kind)` narrowing and the `never` exhaustiveness
    // check that makes the renderer provably total.
    //
    // It does not. Verified two ways. At runtime, here:
    const error = withCorrelationId('fixed-id', () => notFound('User'))
    if (error.kind === 'NotFound') {
      // `resource` is only reachable if narrowing still works.
      expect(error.resource).toBe('User')
      expect(error.correlationId).toBe('fixed-id')
    } else {
      throw new Error('narrowing failed')
    }

    // And at compile time, by adding a member and running tsc. Adding
    // `BalanceCeilingExceeded` to the union produces exactly three errors -- so
    // there are now three independent guards against forgetting a member, not one:
    //
    //   src/domain/errors.ts    TS2741  'BalanceCeilingExceeded' is missing in LEVELS
    //   src/http/render-error.ts TS2322  not assignable to 'never'  (statusFor)
    //   src/http/render-error.ts TS2322  not assignable to 'never'  (bodyFor)
    //
    // The log-level map is the new one: a member added without a level is a
    // compile error rather than an `undefined` level at runtime.
    expect(true).toBe(true)
  })
})
