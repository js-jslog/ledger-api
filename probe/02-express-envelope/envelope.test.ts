import express from 'express'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import {
  buildAppWithThreeArgHandler,
  buildAppWithoutErrorHandler,
  buildProbeApp,
} from './app.js'

describe('§8 acceptance criteria', () => {
  test('C1: a path argument on the 404 fallback throws at startup', () => {
    // Under path-to-regexp v8 the bare '*' is no longer a valid pattern.
    expect(() => express().use('*', (_req, res) => res.end())).toThrow()
    expect(() => express().all('*', (_req, res) => res.end())).toThrow()

    // ...and '/*splat' is the v8 spelling that does work, which matters because
    // it is the migration the error message pushes you towards.
    expect(() => express().all('/*splat', (_req, res) => res.end())).not.toThrow()
  })

  test('C2: malformed JSON renders a spec-shaped 400, not a bare {}', async () => {
    const res = await request(buildProbeApp())
      .post('/echo-body')
      .set('content-type', 'application/json')
      .send('{"name": "unclosed')

    expect(res.status).toBe(400)
    // BadRequestErrorResponse requires both keys.
    expect(res.body).toHaveProperty('message')
    expect(res.body).toHaveProperty('details')
    expect(res.body.details[0]).toMatchObject({ type: 'entity.parse.failed' })
  })

  test('C2b: with no dedicated branch the default rendering is a bare 400', async () => {
    // Proves the branch in errorMiddleware is doing the work, by showing what
    // body-parser produces when the error reaches Express's default handler.
    const bare = express()
    bare.use(express.json())
    bare.post('/x', (_req, res) => res.json({ ok: true }))
    const res = await request(bare)
      .post('/x')
      .set('content-type', 'application/json')
      .send('{"broken')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({}) // no message, no details
  })

  test('C3: with no error handler, Express 5 leaks a stack trace', async () => {
    const res = await request(buildAppWithoutErrorHandler()).get('/throws-sync')
    expect(res.status).toBe(500)
    expect(res.text).toContain('/absolute/path/in/stack')
    expect(res.text).toMatch(/at .*probe\/02-express-envelope/) // real filesystem paths
  })

  test('C4: a non-JSON content type leaves req.body undefined, not {}', async () => {
    const asText = await request(buildProbeApp())
      .post('/echo-body')
      .set('content-type', 'text/plain')
      .send('name=x')
    expect(asText.body).toEqual({ bodyType: 'undefined', isUndefined: true })

    const noContentType = await request(buildProbeApp()).post('/echo-body')
    expect(noContentType.body).toEqual({ bodyType: 'undefined', isUndefined: true })

    // For contrast: a well-formed JSON content type with an empty body gives {}.
    const emptyJson = await request(buildProbeApp())
      .post('/echo-body')
      .set('content-type', 'application/json')
    expect(emptyJson.body).toEqual({ bodyType: 'object', isUndefined: false })
  })

  test('C5: res.json(undefined) is a silent empty 200', async () => {
    const res = await request(buildProbeApp()).get('/dropped-value')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBe('0')
    expect(res.text).toBe('')
  })
})

describe('beyond the five criteria', () => {
  test('sync and async throws both reach the one renderer', async () => {
    const app = buildProbeApp()
    for (const path of ['/throws-sync', '/throws-async']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(500)
      expect(res.body, path).toEqual({ message: 'An unexpected error occurred' })
      expect(res.text, path).not.toContain('at ') // no stack leak
    }
  })

  test('a rejection from async MIDDLEWARE also propagates', async () => {
    // §14 lists "async middleware error propagation" as unverified, and it is
    // the mechanism the JWT middleware depends on for its 401s.
    const res = await request(buildProbeApp()).get('/throws-in-async-middleware')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ message: 'An unexpected error occurred' })
  })

  test('a throw after the response is sent does not corrupt it', async () => {
    const res = await request(buildProbeApp()).get('/throws-after-send')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ partial: true })
  })

  test('an unmatched route gets the JSON 404 envelope', async () => {
    const res = await request(buildProbeApp()).get('/no-such-route')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ message: 'Resource was not found' })
  })

  test('TRAP: a three-argument error handler is silently not an error handler', async () => {
    const res = await request(buildAppWithThreeArgHandler()).get('/throws-sync')
    // Express dispatches on fn.length === 4. With three params this is ordinary
    // middleware, so the error skips it and Express's default handler runs --
    // reinstating the stack-trace leak C3 is supposed to have closed.
    expect(res.body).not.toEqual({ message: 'from my handler' })
    expect(res.status).toBe(500)
    expect(res.text).toContain('at ')
  })
})
