import express, { type Express } from 'express'
import type { Kysely } from 'kysely'

import type { Database } from '../db/schema.js'
import { correlationMiddleware } from '../observability/correlation.js'
import { usersRepository } from '../repo/users.js'
import { authService } from '../service/auth.js'
import { usersService } from '../service/users.js'
import { login } from './auth.js'
import { errorMiddleware, notFoundFallback } from './error-middleware.js'
import { health } from './health.js'
import { createUser } from './users.js'

/**
 * The composition root. Every route this service answers is registered here, one line
 * each, and there is no registry, no decorator and no filesystem scan between this file
 * and the handler it names — so the list of routes is readable in one place and adding
 * one is a single line.
 *
 * It returns the app rather than starting it. `src/main.ts` is the only thing that
 * listens, which is what lets a test drive the whole HTTP stack without a port.
 */
export const createApp = (db: Kysely<Database>): Express => {
  const app = express()

  // The whole of the wiring. Each service is built once here from the handle this
  // function was given, so nothing below reaches for a connection of its own.
  const repo = usersRepository(db)
  const users = usersService(repo)
  const auth = authService(repo)

  // Route-independent concerns, above every route rather than inside any handler. The
  // body limit is a decision rather than a default: without one, a request body is
  // bounded only by memory. Exceeding it is rendered as a 400 by the error middleware,
  // because the specification publishes no 413.
  app.use(correlationMiddleware)
  app.use(express.json({ limit: '16kb' }))

  app.get('/health', health)
  app.post('/v1/users', createUser(users))
  app.post('/v1/auth/login', login(auth))

  // After every route, in this order. `notFoundFallback` takes no path argument: under
  // path-to-regexp v8 both `app.use('*')` and `app.all('*')` throw at startup.
  app.use(notFoundFallback)
  app.use(errorMiddleware)

  return app
}
