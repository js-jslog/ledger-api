import express, { type Express, type RequestHandler } from 'express'
import { errorMiddleware, notFoundMiddleware } from '../../src/http/error-middleware.js'

/** The assembly under test: routes, then 404 fallback, then error handler. */
export function buildProbeApp(): Express {
  const app = express()
  app.use(express.json())

  // Criterion 4: what does req.body look like for a non-JSON content type?
  app.post('/echo-body', (req, res) => {
    res.status(200).json({ bodyType: typeof req.body, isUndefined: req.body === undefined })
  })

  // Criterion 5: the shape a handler falls into when a Result's value is dropped.
  app.get('/dropped-value', (_req, res) => {
    const value = undefined as { id: string } | undefined
    res.json(value)
  })

  app.get('/throws-sync', () => {
    throw new Error('sync boom with /absolute/path/in/stack')
  })

  // Express 5's headline feature: rejected promises from async handlers.
  app.get('/throws-async', async () => {
    await Promise.resolve()
    throw new Error('async boom')
  })

  // Does a rejection from async *middleware* also propagate? (§14 asks this of
  // the JWT middleware specifically.)
  app.get(
    '/throws-in-async-middleware',
    async (_req, _res, next) => {
      await Promise.resolve()
      throw new Error('middleware boom')
      next()
    },
    (_req, res) => {
      res.json({ reached: 'route body' })
    },
  )

  // Writes a response, then fails. Exercises the headersSent guard.
  app.get('/throws-after-send', (_req, res) => {
    res.status(200).json({ partial: true })
    throw new Error('too late')
  })

  app.use(notFoundMiddleware)
  app.use(errorMiddleware)
  return app
}

/** Same routes, but with NO error handler registered — §8's leak claim. */
export function buildAppWithoutErrorHandler(): Express {
  const app = express()
  app.use(express.json())
  app.get('/throws-sync', () => {
    throw new Error('sync boom with /absolute/path/in/stack')
  })
  return app
}

/**
 * The three-argument error handler: Express dispatches on fn.length === 4, so
 * this is silently treated as ordinary middleware and never sees the error.
 */
export function buildAppWithThreeArgHandler(): Express {
  const app = express()
  app.get('/throws-sync', () => {
    throw new Error('sync boom')
  })
  // Deliberately the wrong arity. Note what TypeScript does here: it does NOT
  // report "this is not an error handler". It silently reinterprets the three
  // parameters as (req, res, next), so the only complaint is that `res` has no
  // `.status` -- because TS thinks `res` is the NextFunction. The diagnostic
  // points at the body, never at the arity, which is why this is worth a probe.
  const threeArg = (_err: unknown, _req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }): void => {
    res.status(500).json({ message: 'from my handler' })
  }
  app.use(threeArg as unknown as RequestHandler)
  return app
}
