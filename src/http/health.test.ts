import request from 'supertest'
import { afterAll, describe, expect, test } from 'vitest'

import { connect, testDatabaseUrl } from '../db/connection.js'
import { createApp } from './app.js'

// `/health` touches no table, but `createApp` composes the whole service graph, so it
// needs a handle. Its own pool, destroyed here: an open pool holds the vitest process
// open past the last assertion. R12.
const db = connect(testDatabaseUrl())

afterAll(async () => {
  await db.destroy()
})

describe('GET /health', () => {
  test('answers 200 with a body', async () => {
    const response = await request(createApp(db)).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })
})
