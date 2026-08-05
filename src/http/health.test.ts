import request from 'supertest'
import { describe, expect, test } from 'vitest'

import { createApp } from './app.js'

describe('GET /health', () => {
  test('answers 200 with a body', async () => {
    const response = await request(createApp()).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })
})
