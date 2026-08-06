import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import type { RequestHandler } from 'express'

const correlationIds = new AsyncLocalStorage<string>()

/**
 * The id is minted once per request, not once per error. Two records from one request
 * that share nothing give a collector nothing to stitch together — which is the failure
 * that leaves the mechanism looking like it works while answering no question.
 *
 * An inbound `x-correlation-id` is deliberately ignored rather than honoured. See R22:
 * there is no upstream here, and a client-controlled value lets a caller collide with
 * another request's id on purpose.
 */
const CORRELATION_HEADER = 'x-correlation-id'

export const correlationMiddleware: RequestHandler = (_req, res, next) => {
  const correlationId = randomUUID()

  // Echoed on every response, not only failures. A user reporting "it was slow at 3pm"
  // has something to quote even though nothing went wrong, and the error envelope's copy
  // covers only the requests that failed.
  res.setHeader(CORRELATION_HEADER, correlationId)

  correlationIds.run(correlationId, next)
}

/**
 * Code reached outside any request still logs, and a record with no id at all is worse
 * than one that says so. Nothing renders an envelope from here, so this string cannot
 * reach a client.
 */
export const OUTSIDE_REQUEST = 'outside-request'

export const currentCorrelationId = (): string => correlationIds.getStore() ?? OUTSIDE_REQUEST
