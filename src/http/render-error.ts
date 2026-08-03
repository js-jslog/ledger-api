import type { Response } from 'express'
import type { DomainError } from '../domain/errors.js'

/**
 * The one renderer. Every error envelope in the service is produced here.
 *
 * The `never` assignment in the default branch is what makes "the union stays
 * closed" a compile-time claim rather than a comment: adding a member to
 * DomainError without adding a case here fails `tsc`. Probe 02 verifies that.
 */
export function renderError(res: Response, error: DomainError): void {
  switch (error.kind) {
    case 'ValidationFailed':
      // The spec's BadRequestErrorResponse requires BOTH `message` and
      // `details`, so `details` is never omitted even when empty.
      res.status(400).json({ message: 'Invalid request', details: error.details })
      return
    case 'Unauthenticated':
      res.status(401).json({ message: 'Access token is missing or invalid' })
      return
    case 'Forbidden':
      res.status(403).json({ message: 'Forbidden' })
      return
    case 'NotFound':
      res.status(404).json({ message: `${error.resource} was not found` })
      return
    case 'AlreadyExists':
      res.status(409).json({ message: `${error.resource} already exists` })
      return
    case 'InsufficientFunds':
      res.status(422).json({ message: 'Insufficient funds to process transaction' })
      return
    case 'Unexpected':
      // `cause` is deliberately not rendered. §8: with no handler at all,
      // Express 5 leaks a stack trace with absolute filesystem paths.
      console.error('unexpected error', error.cause)
      res.status(500).json({ message: 'An unexpected error occurred' })
      return
    default: {
      const exhaustive: never = error
      throw new Error(`unrenderable error: ${JSON.stringify(exhaustive)}`)
    }
  }
}
