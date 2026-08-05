/**
 * A test enforced by `pnpm typecheck`. Section 3's "no credential and no request-body
 * value ever reaches a log record" is listed as mechanised rather than remembered, and
 * `payload?: never` is the mechanism — so it is worth knowing that the mechanism still
 * reports, rather than trusting that nothing has switched it off.
 *
 * The asymmetry is the interesting half. `unexpected` must keep accepting a payload,
 * because egress validation will hand it a body that failed its own published schema and
 * that body is the entire diagnostic. R24 records what that costs.
 */
import { notFound, unexpected, validationFailed } from './errors.js'

// ── Forbidden, on every constructor a client's input can reach ───────────────────

validationFailed('Invalid request body', [], {
  // @ts-expect-error -- a request body cannot be logged, and re-adding it is a build failure.
  payload: { email: 'someone@example.com', password: 'hunter2' },
})

notFound('Resource not found', {
  // @ts-expect-error -- same ban, and it is the parameter type rather than a review rule.
  payload: { accountNumber: '01234567' },
})

// ── Permitted, and deliberately so ──────────────────────────────────────────────

unexpected(new Error('response failed its published schema'), {
  payload: { balance: 1099, password_hash: 'never-reaches-a-client' },
})

// ── What is meant to go instead ─────────────────────────────────────────────────
// Field names, never values. Both constructors accept these.

validationFailed('Invalid request body', [], { fields: ['email', 'password'] })
notFound('Resource not found', { method: 'GET', path: '/no-such-route' })

// ── THE LIMIT, pinned rather than blessed ───────────────────────────────────────
// Everything below compiles. That is not an endorsement — it is the boundary of what
// the guard above is, recorded here so it is known rather than discovered, in the same
// way the naming rule's ambiguity guard is pinned by a `valid` case rather than argued
// about.
//
// `payload?: never` is a denylist of one key name. Any other name carries the same value
// past it, and the spread is the worst case because every field arrives under its own
// name. Nothing in the codebase does any of this; the point is that nothing stops it.
//
// If these lines ever start FAILING, an allowlist has been adopted — see R24 — and this
// section should be deleted rather than repaired.

const body = { email: 'someone@example.com', password: 'hunter2' }

validationFailed('Invalid request body', [], { body })
validationFailed('Invalid request body', [], { requestBody: body, data: body })
validationFailed('Invalid request body', [], { ...body })
