/**
 * The complete set of expected outcomes that are not the happy path. Every one of
 * these is a normal thing for a bank API to be asked to do, so none of them is an
 * exception. This is the "covering role" the brief wants Result to play: the union
 * below is exhaustive, and the HTTP layer's mapping over it is checked by the
 * compiler (see `toHttp` in src/http/errorMapping.ts).
 */
export type DomainError =
  | { kind: 'VALIDATION'; details: { field: string; message: string; type: string }[] }
  | { kind: 'UNAUTHENTICATED'; reason: 'MISSING' | 'MALFORMED' | 'EXPIRED' | 'BAD_CREDENTIALS' }
  | { kind: 'FORBIDDEN'; resource: 'user' | 'account' | 'transaction' }
  | { kind: 'NOT_FOUND'; resource: 'user' | 'account' | 'transaction' }
  | { kind: 'CONFLICT'; reason: 'USER_HAS_ACCOUNTS' | 'EMAIL_TAKEN' }
  | { kind: 'INSUFFICIENT_FUNDS'; balancePence: number; requestedPence: number }
  | { kind: 'NOT_IMPLEMENTED'; operation: string }
  // Expected-but-unrecoverable. Kept inside the union rather than thrown so that
  // the HTTP boundary has exactly one input type and no path can bypass the mapping.
  | { kind: 'INTERNAL'; detail: string }

export const validation = (
  details: { field: string; message: string; type: string }[],
): DomainError => ({ kind: 'VALIDATION', details })

export const notFound = (resource: 'user' | 'account' | 'transaction'): DomainError => ({
  kind: 'NOT_FOUND', resource,
})

export const forbidden = (resource: 'user' | 'account' | 'transaction'): DomainError => ({
  kind: 'FORBIDDEN', resource,
})
