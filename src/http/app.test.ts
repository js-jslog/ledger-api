import type { Express } from 'express'
import request from 'supertest'
import { afterAll, expect, test } from 'vitest'

import { connect, testDatabaseUrl } from '../db/connection.js'
import { capturedLogs } from '../../test/observability/captured-logs.js'
import { createApp } from './app.js'

const db = connect(testDatabaseUrl())
const app = createApp(db)

capturedLogs()

afterAll(async () => {
  await db.destroy()
})

/**
 * R39'S CLOSURE, AND THE GAP IT CLOSES IS NOT IN THE ADAPTER.
 *
 * `authedHandler` makes an unauthenticated handler unrepresentable *inside* a route. It
 * does nothing about *choosing* it: `app.get('/v1/users/:userId', publicHandler(…))`
 * compiles, lints and passes every happy-path test written against that endpoint. The
 * decision is one line in the composition root, and until this file existed nothing looked
 * at it.
 *
 * A sweep rather than a test per route, so a route added later is covered without anyone
 * remembering to cover it. The cost is the list below, which has to be maintained by hand —
 * and that is the point: adding a route to it is a deliberate statement that the endpoint
 * is public, in a file whose only subject is that question.
 */
const PUBLIC_ROUTES = [
  // Absent from the specification and deliberately outside `/v1` — docs/spec-changes.md.
  { method: 'get', path: '/health' },
  // The two endpoints a caller reaches before it has a token: one mints the identity, the
  // other exchanges a credential for the means to prove it.
  { method: 'post', path: '/v1/users' },
  { method: 'post', path: '/v1/auth/login' },
] as const

type Route = { readonly method: string; readonly path: string }

/**
 * Express publishes no types for its router stack, so this reads an undocumented shape and
 * the cast says so. It is worth the fragility: the alternative is a hand-written list of
 * routes to compare against, which is a second copy of `createApp` and would go stale in
 * exactly the case this file exists to catch — someone adding a route and not thinking
 * about authentication.
 *
 * `app.use` layers carry no `route` and are skipped; the two error middlewares are those.
 */
const registeredRoutes = (target: Express): readonly Route[] => {
  const { stack } = (target as unknown as { router: { stack: readonly unknown[] } }).router

  return stack.flatMap((layer) => {
    const route = (layer as { route?: { path: string; methods: Record<string, boolean> } }).route

    return route === undefined
      ? []
      : Object.keys(route.methods).map((method) => ({ method, path: route.path }))
  })
}

const isPublic = (route: Route): boolean =>
  PUBLIC_ROUTES.some((allowed) => allowed.method === route.method && allowed.path === route.path)

const routes = registeredRoutes(app)
const authenticatedRoutes = routes.filter((route) => !isPublic(route))

/**
 * A path parameter is substituted with a value that satisfies no published pattern, which
 * sharpens the claim rather than weakening it: authentication runs inside the adapter and
 * therefore *before* the handler validates anything, so a caller with no token learns
 * nothing about the shape the path parameter should have taken.
 */
const drive = (route: Route): request.Test => {
  const agent = request(app)
  const path = route.path.replace(/:[A-Za-z0-9_]+/g, 'not-a-valid-identifier')

  switch (route.method) {
    case 'get':
      return agent.get(path)
    case 'post':
      return agent.post(path)
    case 'patch':
      return agent.patch(path)
    case 'delete':
      return agent.delete(path)
    default:
      // A method the sweep cannot drive must stop the suite rather than be skipped
      // silently, which would be a route quietly leaving the sweep's coverage.
      throw new Error(`the route sweep cannot drive ${route.method.toUpperCase()}`)
  }
}

/**
 * Without this the sweep passes by asserting over an empty set, which is why R39 says it
 * was not written at the previous step. It is the assertion that makes every other one in
 * this file mean something.
 */
test('the sweep covers at least one route', () => {
  expect(authenticatedRoutes.length).toBeGreaterThan(0)
})

test.each(authenticatedRoutes)(
  'answers 401 to an unauthenticated $method $path',
  async (route) => {
    const response = await drive(route)

    expect(response.status).toBe(401)
  },
)

/**
 * The other direction, and it is what stops the list above from being a way to silence this
 * file: naming a genuinely authenticated route as public fails here instead.
 */
test.each(PUBLIC_ROUTES)('does not require authentication for $method $path', async (route) => {
  const response = await drive(route)

  expect(response.status).not.toBe(401)
})
