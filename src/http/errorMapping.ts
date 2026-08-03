import type { DomainError } from '../domain/errors.js'

export interface HttpError {
  status: number
  body: { message: string; details?: { field: string; message: string; type: string }[] }
}

const unreachable = (x: never): never => {
  throw new Error(`unhandled DomainError: ${JSON.stringify(x)}`)
}

/**
 * The single place where domain outcomes become status codes. Because DomainError is
 * a closed union and this switch ends in `unreachable(e)`, adding a new domain
 * outcome without deciding its status code is a compile error rather than an
 * accidental 500. That is the argument for neverthrow here, stated concretely.
 */
export const toHttp = (e: DomainError): HttpError => {
  switch (e.kind) {
    case 'VALIDATION':
      return { status: 400, body: { message: 'Invalid details supplied', details: e.details } }
    case 'UNAUTHENTICATED':
      return { status: 401, body: { message: 'Access token is missing or invalid' } }
    case 'FORBIDDEN':
      return { status: 403, body: { message: `The user is not allowed to access the ${e.resource}` } }
    case 'NOT_FOUND':
      return { status: 404, body: { message: `${e.resource} was not found` } }
    case 'CONFLICT':
      return e.reason === 'USER_HAS_ACCOUNTS'
        ? { status: 409, body: { message: 'A user cannot be deleted when they are associated with a bank account' } }
        : { status: 409, body: { message: 'That email address is already registered' } }
    case 'INSUFFICIENT_FUNDS':
      return { status: 422, body: { message: 'Insufficient funds to process transaction' } }
    case 'INTERNAL':
      return { status: 500, body: { message: 'An unexpected error occurred' } }
    case 'NOT_IMPLEMENTED':
      return { status: 501, body: { message: `${e.operation} is not implemented` } }
    default:
      return unreachable(e)
  }
}
