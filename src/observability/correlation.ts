import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

/**
 * The correlation id: minted **once per request**, read by every error
 * constructor, and returned to the client.
 *
 * Once per request is the whole point. If each error minted its own id, two
 * records from the same request would share nothing and the collector would have
 * nothing to correlate — which is the failure that makes the whole mechanism
 * pointless while still looking like it works.
 *
 * `AsyncLocalStorage` is what makes that possible without threading an id through
 * every function signature down to the repository layer. The store survives
 * `await`, so a constructor five layers deep reads the same id the middleware set.
 */
const store = new AsyncLocalStorage<string>()

/**
 * What a correlation id reads as when there is no request. Errors do get built
 * outside a request — at startup, during migrations, in unit tests — and the type
 * says `correlationId: string`, so there has to be a value. A named sentinel is
 * better than an empty string, because it is greppable and it tells you the record
 * is not part of any request rather than that correlation is broken.
 */
export const NO_REQUEST_CONTEXT = 'no-request-context'

export function currentCorrelationId(): string {
  return store.getStore() ?? NO_REQUEST_CONTEXT
}

/** Runs `fn` with a correlation id in scope. Exposed for tests and for jobs. */
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return store.run(correlationId, fn)
}

export const CORRELATION_HEADER = 'x-correlation-id'

/**
 * Establishes the id for the request, and echoes it on the response so a failure
 * a user reports can be found in the logs.
 *
 * The id is always minted here and an inbound `x-correlation-id` is ignored. In a
 * distributed system you would want to accept an upstream id to stitch traces
 * across services; here there is no upstream, and a client-controlled value would
 * let a caller collide or poison other requests' log correlation. Accepting
 * propagation behind an allowlist of trusted callers is the extension, not the
 * default.
 *
 * Must be registered before any route, or handlers run outside the store and every
 * error reads NO_REQUEST_CONTEXT.
 */
export const correlationMiddleware: RequestHandler = (_req, res, next) => {
  const correlationId = randomUUID()
  res.setHeader(CORRELATION_HEADER, correlationId)
  store.run(correlationId, next)
}
