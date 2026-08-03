import express, { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { errorMiddleware } from '../../src/http/error-middleware.js'
import { egressCheck, isJsonValidRz } from '../../src/http/is-json-valid-rz.js'
import { handler, okBody } from '../../src/http/handler.js'
import {
  bankAccountResponseSchema,
  userResponseSchema,
} from '../../src/http/response-schemas.js'
import { correlationMiddleware } from '../../src/observability/correlation.js'
import { captureLogs, resetLogSink, type LogRecord } from '../../src/observability/logger.js'
import { ok } from 'neverthrow'

let logs: LogRecord[]

beforeEach(() => {
  logs = captureLogs()
})

afterEach(() => {
  resetLogSink()
})

/** An app whose single route returns whatever body it is given. */
function appReturning(body: unknown, schema: object = userResponseSchema): Express {
  const app = express()
  app.use(correlationMiddleware)
  app.get(
    '/thing',
    handler(schema, () => Promise.resolve(ok(okBody(body)))),
  )
  app.use(errorMiddleware)
  return app
}

const VALID_USER_BODY = {
  id: 'usr-abc123',
  name: 'Test User',
  address: { line1: '1 High Street', town: 'Manchester', county: 'Greater Manchester', postcode: 'M1 1AA' },
  phoneNumber: '+447700900000',
  email: 'test@example.com',
  createdTimestamp: '2026-08-03T12:00:00.000Z',
  updatedTimestamp: '2026-08-03T12:00:00.000Z',
}

describe('THE TRAP: validating the in-memory object checks the wrong thing', () => {
  test('a Date satisfies type:object but fails type:string/date-time', () => {
    // Ajv's type checks are typeof-based, so this is the failure mode that makes
    // egress validation subtly useless if it runs before serialisation.
    const asString = isJsonValidRz({
      type: 'object',
      required: ['t'],
      properties: { t: { type: 'string', format: 'date-time' } },
      additionalProperties: false,
    } as const)
    const asObject = isJsonValidRz({
      type: 'object',
      required: ['t'],
      properties: { t: { type: 'object' } },
      additionalProperties: false,
    } as const)

    const live = { t: new Date('2026-08-03T12:00:00.000Z') }
    expect(asObject(live).isOk()).toBe(true) // a Date IS an object to Ajv
    expect(asString(live).isErr()).toBe(true) // ...and is NOT a date-time string

    // But the client receives a string, because JSON.stringify calls toISOString.
    const asSent: unknown = JSON.parse(JSON.stringify(live))
    expect(asString(asSent).isOk()).toBe(true)
  })

  test('egressCheck validates the serialised form, so a Date passes', () => {
    // The same body that failed above passes here, because egressCheck round-trips
    // through JSON first -- it checks what the client will actually receive.
    const check = egressCheck({
      type: 'object',
      required: ['t'],
      properties: { t: { type: 'string', format: 'date-time' } },
      additionalProperties: false,
    })
    expect(check({ t: new Date('2026-08-03T12:00:00.000Z') }).isOk()).toBe(true)
  })

  test('undefined values are dropped by serialisation, which changes the verdict', () => {
    // A row carrying `undefined` looks like it has the property in memory and does
    // not once serialised. Validating in memory would miss a missing required field.
    const check = egressCheck({
      type: 'object',
      required: ['a', 'b'],
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      additionalProperties: false,
    })
    const result = check({ a: 'present', b: undefined })
    expect(result.isErr()).toBe(true) // `b` vanishes in the JSON the client gets
  })
})

describe('a non-conformant response is a 500, not a 200', () => {
  test('a missing required field is caught before the client sees it', async () => {
    const { email: _email, ...withoutEmail } = VALID_USER_BODY
    const res = await request(appReturning(withoutEmail)).get('/thing').expect(500)
    expect(res.body.message).toBe('An unexpected error occurred')
    // The mismatch is in the log, not the response.
    const record = logs.find((r) => r.event === 'domain_error')
    expect(record).toMatchObject({ kind: 'Unexpected', level: 'error' })
    expect(JSON.stringify(record)).toContain('email')
  })

  test('a malformed id is caught even though the shape is otherwise right', async () => {
    const res = await request(appReturning({ ...VALID_USER_BODY, id: 'not-a-user-id' }))
      .get('/thing')
      .expect(500)
    expect(res.body.correlationId).toEqual(expect.any(String))
  })

  test('THE PAYOFF: a leaked password hash becomes a 500, not a disclosure', async () => {
    // §3: "No persistence entity and no password hash ever reaches a response
    // body." Until now that was a rule the mapping functions were trusted to
    // follow. With additionalProperties: false on the response schema it is
    // checked -- a leak is a caught bug rather than a silent disclosure.
    const leaky = { ...VALID_USER_BODY, password_hash: '$2b$10$somethingreal' }
    const res = await request(appReturning(leaky)).get('/thing').expect(500)

    expect(JSON.stringify(res.body)).not.toContain('$2b$10$')
    const record = logs.find((r) => r.event === 'domain_error')
    expect(JSON.stringify(record)).toContain('password_hash')
  })

  test('a conformant response is untouched', async () => {
    const res = await request(appReturning(VALID_USER_BODY)).get('/thing').expect(200)
    expect(res.body).toEqual(VALID_USER_BODY)
  })
})

describe('the F13 corrections are load-bearing, not cosmetic', () => {
  test('a balance above the spec ceiling now passes, by deliberate correction', async () => {
    // Probe 08 showed a legal sequence of two £10,000 deposits produces balance
    // 20000, which the SUPPLIED schema rejects on `maximum`. Had the supplied
    // schema been wired in here verbatim, that legal sequence would return 500.
    const account = {
      accountNumber: '01234567',
      sortCode: '10-10-10',
      name: 'Personal',
      accountType: 'personal',
      balance: 20_000,
      currency: 'GBP',
      createdTimestamp: '2026-08-03T12:00:00.000Z',
      updatedTimestamp: '2026-08-03T12:00:00.000Z',
    }
    await request(appReturning(account, bankAccountResponseSchema)).get('/thing').expect(200)
  })

  test('a negative balance is still rejected, so dropping `maximum` kept the floor', async () => {
    const account = {
      accountNumber: '01234567',
      sortCode: '10-10-10',
      name: 'Personal',
      accountType: 'personal',
      balance: -1,
      currency: 'GBP',
      createdTimestamp: '2026-08-03T12:00:00.000Z',
      updatedTimestamp: '2026-08-03T12:00:00.000Z',
    }
    await request(appReturning(account, bankAccountResponseSchema)).get('/thing').expect(500)
  })
})

describe('the hole Ajv structurally cannot see', () => {
  test('symbol-keyed properties are invisible to additionalProperties', () => {
    // Ajv walks Object.keys, which skips symbols, so `additionalProperties: false`
    // never rejects them. Unreachable for request bodies -- express.json() produces
    // JSON.parse output, which cannot contain symbol keys or function values -- so
    // nobody should spend time on it there. It is worth remembering only when the
    // funnel is pointed at an internally constructed object, which is exactly what
    // egress validation does.
    const secret = Symbol('secret')
    const body = { ...VALID_USER_BODY, [secret]: 'invisible' }
    const check = egressCheck(userResponseSchema)
    expect(check(body).isOk()).toBe(true) // not rejected

    // It is harmless here for the same reason it is invisible: JSON.stringify drops
    // symbol keys too, so it cannot reach the client either.
    expect(JSON.stringify(body)).not.toContain('invisible')
  })
})
