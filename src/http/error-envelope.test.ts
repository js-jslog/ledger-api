import express, { type Express } from 'express'
import request from 'supertest'
import { afterAll, describe, expect, test } from 'vitest'

import { capturedLogs } from '../../test/observability/captured-logs.js'
import { connect, testDatabaseUrl } from '../db/connection.js'
import { correlationMiddleware } from '../observability/correlation.js'
import { createApp } from './app.js'
import { errorMiddleware, notFoundFallback } from './error-middleware.js'
import { publicHandler } from './handler.js'
import { validatorFor } from './validator-for.js'

// None of these tests reads a table, but `createApp` composes the whole service graph
// and so needs a handle. Its own pool, destroyed at the end of the file. R12.
const db = connect(testDatabaseUrl())

afterAll(async () => {
  await db.destroy()
})

/**
 * A harness rather than a second composition root. It exists only because the routes
 * these tests need — one that throws, one that answers and then throws — have no place
 * in a service that is supposed to answer requests.
 *
 * The wiring it repeats is pinned against the real thing by the `createApp()` tests
 * below: an unknown route and a malformed body both reach the envelope through the real
 * composition, which is what proves the two terminal middlewares are actually registered
 * there and not only here.
 */
const appWith = (register: (app: Express) => void): Express => {
  const app = express()

  app.use(correlationMiddleware)
  app.use(express.json({ limit: '16kb' }))
  register(app)
  app.use(notFoundFallback)
  app.use(errorMiddleware)

  return app
}

const records = capturedLogs()

describe('the 404 fallback', () => {
  test('answers an unmatched route with the envelope, through the real app', async () => {
    const response = await request(createApp(db)).get('/nope')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      message: 'Resource not found',
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    })
  })

  test('does not reflect the requested path back to the caller', async () => {
    const response = await request(createApp(db)).get('/x-marks-the-spot')

    expect(response.text).not.toContain('x-marks-the-spot')
  })

  test('registering it did not throw at startup', () => {
    // The whole test. `app.use('*')` and `app.all('*')` both throw under path-to-regexp
    // v8, so a path-less `app.use` is not a stylistic choice — the alternatives take the
    // process down before it serves anything, which is what this asserts by not failing.
    expect(() => createApp(db)).not.toThrow()
  })
})

describe('malformed JSON', () => {
  test('is a 400 carrying details, not body-parser default of a bare 400', async () => {
    const response = await request(createApp(db))
      .post('/anything')
      .set('content-type', 'application/json')
      .send('{"email":')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      message: 'Request body is not valid JSON',
      details: [{ field: 'body', message: 'must be valid JSON', type: 'entity.parse.failed' }],
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    })
  })

  test('leaks no fragment of the offending body, to the client or to the log', async () => {
    // body-parser embeds a slice of the input in its own message, so the parser's message
    // is discarded rather than translated. This asserts that it stays discarded.
    //
    // The path is deliberately one that matches no route, because that is the sharper
    // version of the claim: parsing happens before routing, so a body carrying a password
    // reaches the parser whether or not the endpoint it was addressed to exists.
    const password = 'correct-horse-battery-staple'

    const response = await request(createApp(db))
      .post('/no-such-route')
      .set('content-type', 'application/json')
      .send(`{"password":"${password}"`)

    expect(response.status).toBe(400)
    expect(response.text).not.toContain(password)
    expect(JSON.stringify(records())).not.toContain(password)
  })
})

describe('a body over the limit', () => {
  test('is a client error rather than a 500', async () => {
    const response = await request(createApp(db))
      .post('/anything')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(20_000) }))

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      message: 'Request body is too large',
      details: [
        {
          field: 'body',
          message: 'must be within the request size limit',
          type: 'entity.too.large',
        },
      ],
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    })
  })
})

describe('an unhandled throw', () => {
  const boom = new Error('the database fell over at /app/src/db/connection.ts')

  test('renders JSON rather than an HTML page with a stack trace', async () => {
    const app = appWith((a) => {
      a.get('/throws', () => {
        throw boom
      })
    })

    const response = await request(app).get('/throws')

    expect(response.status).toBe(500)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({
      message: 'An unexpected error occurred',
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    })
  })

  test('tells the caller nothing about where it happened', async () => {
    const app = appWith((a) => {
      a.get('/throws', () => {
        throw boom
      })
    })

    const response = await request(app).get('/throws')

    expect(response.text).not.toContain('/app/src')
    expect(response.text).not.toContain('database fell over')
  })

  test('is logged in full, which is the other half of telling the caller nothing', async () => {
    const app = appWith((a) => {
      a.get('/throws', () => {
        throw boom
      })
    })

    await request(app).get('/throws')

    expect(JSON.stringify(records())).toContain('database fell over')
  })

  test('propagates from an async handler too', async () => {
    // Express 5 forwards a rejected promise to the error middleware natively. Express 4
    // did not, which is the version most examples are written against.
    const app = appWith((a) => {
      a.get('/throws-async', async () => {
        await Promise.resolve()
        throw boom
      })
    })

    const response = await request(app).get('/throws-async')

    expect(response.status).toBe(500)
  })
})

describe('a handler that answers and then throws', () => {
  test('keeps the response it already committed instead of crashing the error handler', async () => {
    // The renderer's first act is `res.status(...)`, which throws
    // `Cannot set headers after they are sent` from inside the error middleware — the
    // one place in the stack with nothing above it to catch.
    const app = appWith((a) => {
      a.get('/late', (_req, res) => {
        res.status(200).json({ committed: true })
        throw new Error('after the fact')
      })
    })

    const response = await request(app).get('/late')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ committed: true })
  })
})

describe('the handler adapter', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: { email: { type: 'string' } },
  } as const satisfies Record<string, unknown>

  const validate_bodyRz = validatorFor(schema)

  const app = (): Express =>
    appWith((a) => {
      a.post(
        '/echo',
        publicHandler(schema, (req) =>
          Promise.resolve(validate_bodyRz(req.body).map((body) => ({ status: 201 as const, body }))),
        ),
      )
    })

  test('sends the status and body the Result carried', async () => {
    const response = await request(app())
      .post('/echo')
      .send({ email: 'someone@example.com' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ email: 'someone@example.com' })
  })

  test('renders the error channel through the same envelope as everything else', async () => {
    const response = await request(app()).post('/echo').send({ email: 1 })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      message: 'Invalid request body',
      details: [{ field: 'email', message: 'must be string', type: 'type' }],
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    })
  })

  test('answers 400 rather than 500 when there is no body at all', async () => {
    // `content-type: text/plain` leaves `req.body` as `undefined` rather than `{}`, and
    // an unhandled `undefined` there is a 500 where a 400 belongs.
    const response = await request(app()).post('/echo').set('content-type', 'text/plain').send('hi')

    expect(response.status).toBe(400)
  })

  /**
   * The adapter `await`s the function it wraps, so a service that throws rather than
   * returning `err` rejects the async Express handler rather than reaching `.match()`.
   * Whether that becomes a 500 or an unhandled rejection is a property of Express, not
   * of anything written here — the reference implementation guards it with an explicit
   * `.catch(next)`, which is the Express 4 shape.
   *
   * Measured rather than reasoned about, because it was reasoned about first and the
   * reasoning was wrong: Express 5 propagates the rejection to the error middleware and
   * the envelope comes out intact. This test is what stops that becoming true only
   * until someone changes the adapter.
   */
  test('turns a service that throws into the same 500 envelope', async () => {
    const throwing = appWith((a) => {
      a.get(
        '/throws',
        publicHandler(schema, () => {
          throw new Error('the service exploded')
        }),
      )
    })

    const response = await request(throwing).get('/throws')

    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      message: 'An unexpected error occurred',
      correlationId: response.headers['x-correlation-id'],
    })
  })
})

describe('the correlation id', () => {
  test('is minted once per request, so both records and the envelope agree', async () => {
    const app = appWith((a) => {
      a.get('/throws', () => {
        throw new Error('boom')
      })
    })

    const response = await request(app).get('/throws')

    const ids = [...new Set(records().map((record) => record['correlationId']))]

    expect(records()).toHaveLength(2)
    expect(ids).toHaveLength(1)
    // Asserting the whole envelope against the id the records carry is what makes this
    // "one id per request" rather than "an id is present in each place".
    expect(response.body).toEqual({
      message: 'An unexpected error occurred',
      correlationId: ids[0],
    })
  })

  test('is echoed on a successful response too, not only on failures', async () => {
    const response = await request(createApp(db)).get('/health')

    expect(response.status).toBe(200)
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('matches the envelope on a failure', async () => {
    const response = await request(createApp(db)).get('/nope')

    expect(response.body).toEqual({
      message: 'Resource not found',
      correlationId: response.headers['x-correlation-id'],
    })
  })

  test('differs between requests', async () => {
    const app = createApp(db)

    const first = await request(app).get('/nope')
    const second = await request(app).get('/nope')

    expect(first.body).not.toEqual(second.body)
    expect(records()).toHaveLength(4)
    expect(new Set(records().map((record) => record['correlationId'])).size).toBe(2)
  })

  test('records the outcome separately from the detail, and never both', async () => {
    const app = appWith((a) => {
      a.get('/throws', () => {
        throw new Error('boom')
      })
    })

    await request(app).get('/throws')

    expect(records().map((record) => record['event'])).toEqual(['error.created', 'request.failed'])
    expect(records()[0]).toHaveProperty('cause')
    expect(records()[1]).not.toHaveProperty('cause')
    expect(records()[1]).toHaveProperty('status', 500)
  })

  test('follows the kind rather than being fixed, so a client mistake is not an alert', async () => {
    await request(createApp(db)).get('/nope')

    expect(records().map((record) => record['level'])).toEqual(['info', 'info'])
  })
})
