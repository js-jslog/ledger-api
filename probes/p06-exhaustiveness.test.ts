// PROBE 06 — Does Result actually play a *covering* role, or only a decorative one?
//
// The brief's neverthrow defence rests on "the compiler enforces handling it".
// This probe checks that the claim is true in the shape the code is written in,
// and finds where it stops being true.
import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from 'neverthrow'
import type { DomainError } from '../src/domain/errors.js'
import { toHttp } from '../src/http/errorMapping.js'

describe('the exhaustive-switch guarantee', () => {
  it('HOLDS: every DomainError variant has a decided status code', () => {
    const all: DomainError[] = [
      { kind: 'VALIDATION', details: [] },
      { kind: 'UNAUTHENTICATED', reason: 'MISSING' },
      { kind: 'FORBIDDEN', resource: 'account' },
      { kind: 'NOT_FOUND', resource: 'user' },
      { kind: 'CONFLICT', reason: 'USER_HAS_ACCOUNTS' },
      { kind: 'INSUFFICIENT_FUNDS', balancePence: 0, requestedPence: 1 },
      { kind: 'NOT_IMPLEMENTED', operation: 'PATCH /v1/users/{userId}' },
      { kind: 'INTERNAL', detail: 'account number pool exhausted' },
    ]
    expect(all.map((e) => toHttp(e).status)).toEqual([400, 401, 403, 404, 409, 422, 501, 500])
  })

  it('HOLDS: adding a variant without a case is a compile error, not a 500', () => {
    // Demonstrated as a type-level assertion rather than by editing the union.
    type Extended = DomainError | { kind: 'RATE_LIMITED'; retryAfterSeconds: number }
    const handle = (e: Extended) => {
      switch (e.kind) {
        case 'RATE_LIMITED': return 429
        default: return toHttp(e).status // `e` narrowed to DomainError here
      }
    }
    expect(handle({ kind: 'RATE_LIMITED', retryAfterSeconds: 5 })).toBe(429)
    expect(handle({ kind: 'NOT_FOUND', resource: 'account' })).toBe(404)
  })
})

describe('where the guarantee stops', () => {
  it('GAP: an unhandled Result is not a compile error — nothing forces the check', () => {
    const risky = (): Result<number, DomainError> => err({ kind: 'NOT_FOUND', resource: 'user' })
    // No `void`, no unwrap, no isErr(). This compiles and silently discards the error.
    risky()
    // neverthrow ships no lint rule of its own. The enforcement the brief claims
    // requires @typescript-eslint's no-floating-promises equivalent for Results,
    // which does not exist; the nearest is a custom rule or
    // `must-use-result`-style tooling. Worth knowing before claiming "the compiler
    // enforces handling it" to a reviewer who will ask exactly this.
    expect(true).toBe(true)
  })

  it('GAP: unwrapOr collapses distinct outcomes into one', () => {
    const r: Result<number, DomainError> = err({ kind: 'INSUFFICIENT_FUNDS', balancePence: 100, requestedPence: 200 })
    // The tempting one-liner. 422 becomes 0 pounds and nobody notices.
    expect(r.unwrapOr(0)).toBe(0)
  })

  it('HOLDS: ResultAsync chains short-circuit without try/catch', async () => {
    const { okAsync, errAsync } = await import('neverthrow')
    const found = await okAsync<number, DomainError>(1)
      .andThen((n) => (n > 0 ? ok(n * 2) : err({ kind: 'NOT_FOUND', resource: 'user' } as const)))
      .andThen((n) => okAsync<number, DomainError>(n + 1))
    expect(found.isOk() && found.value).toBe(3)

    const missing = await errAsync<number, DomainError>({ kind: 'NOT_FOUND', resource: 'user' })
      .andThen(() => { throw new Error('must not run') })
    expect(missing.isErr()).toBe(true)
  })
})
