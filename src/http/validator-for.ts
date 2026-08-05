import { Ajv, type ErrorObject } from 'ajv'
import addFormatsCjs from 'ajv-formats'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { err, ok, type Result } from 'neverthrow'

import { unexpected, validationFailed, type DomainError, type FieldError } from '../domain/errors.js'
import { isWithinScale } from '../domain/money.js'

/**
 * One JSON Schema is the source of truth for both the runtime check and the
 * compile-time type. There is no second place to state the shape, so the two cannot
 * disagree — a mismatched assertion is unrepresentable rather than something review
 * has to catch.
 */

/**
 * `ajv-formats` is CommonJS whose dist does `module.exports = exports = formatsPlugin`,
 * while its `.d.ts` declares an ESM `export default`. Under `nodenext` with
 * `verbatimModuleSyntax`, TypeScript types the default import as the module NAMESPACE,
 * which is not callable, while Node hands over the function. The types are wrong about
 * the runtime, so the cast has to say so. `esModuleInterop` does not help, because
 * `verbatimModuleSyntax` suppresses the synthesised interop it would rely on.
 *
 * Ajv has the same defect and does NOT need a cast, because it publishes a named
 * export alongside the default — so `import { Ajv }` sidesteps the question. Worth
 * saying, because the natural `import Ajv from 'ajv'` fails identically ("this
 * expression is not constructable") and the fix is a different one.
 */
const addFormats = addFormatsCjs as unknown as (typeof addFormatsCjs)['default']

// Every option here is asserted by a test in validator-for.test.ts, which is why none
// of them carries a comment saying what it does.
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
})

addFormats(ajv)

/**
 * Registered here, beside the instance, because ordering is the whole hazard: a schema
 * carrying `currencyScale` that is compiled before this line throws
 * `strict mode: unknown keyword: "currencyScale"` at startup. That loud failure is the
 * good outcome and `strict: true` is what produces it — with `strict: false` the keyword
 * would be silently ignored and 3dp amounts would validate. Asserted in the tests.
 *
 * It does a different job from `toPennies`, which is why both exist: this produces a
 * spec-shaped entry in the 400's `details` array at ingress, and `toPennies` is the
 * guarantee that no conversion can happen anywhere without the same check. They share
 * the predicate, so they cannot disagree.
 */
ajv.addKeyword({
  keyword: 'currencyScale',
  type: 'number',
  errors: false,
  schemaType: 'number',
  validate: (scale: number, amount: number) => isWithinScale(amount, scale),
})

/**
 * Ajv reports the offending location as a JSON pointer, and separately names the
 * property for the two keywords where the location alone is not enough: a missing
 * required property, and an unexpected one.
 *
 * Only property NAMES are read here, never values. Unknown key names already reach
 * the client in `details[].field`, so this adds no exposure class — but it is the
 * reason to be careful, because the same function is one step from data that must
 * never be logged or echoed.
 */
const fieldOf = (error: ErrorObject): string => {
  const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.')
  const params: Record<string, unknown> = error.params
  const named = params['missingProperty'] ?? params['additionalProperty']

  if (typeof named === 'string') return path === '' ? named : `${path}.${named}`
  return path === '' ? 'body' : path
}

/**
 * Deliberately reads `message` and `keyword` only, and not `params`.
 *
 * Ajv's messages carry property names and schema constraints but never the offending
 * value — `must NOT have fewer than 12 characters`, not the password that was too
 * short. `params` is where values could appear, so not reading it keeps that true by
 * construction rather than by inspection of every keyword this API uses.
 */
const toFieldError = (error: ErrorObject): FieldError => ({
  field: fieldOf(error),
  message: error.message ?? 'is invalid',
  type: error.keyword,
})

export function validatorFor<S extends object>(
  schema: S,
): (body: unknown) => Result<FromSchema<S & JSONSchema>, DomainError> {
  type T = FromSchema<S & JSONSchema>

  const validate = ajv.compile<T>(schema)

  return (body: unknown): Result<T, DomainError> => {
    // An absent or non-JSON content-type leaves the body `undefined` rather than `{}`.
    // Ajv would report `must be object`, which is true but unhelpful; more to the
    // point, an unhandled `undefined` here is a 500 where a 400 belongs.
    if (body === undefined) {
      return err(
        validationFailed('Invalid request body', [
          { field: 'body', message: 'Request body is required', type: 'required' },
        ]),
      )
    }

    if (!validate(body)) {
      return err(validationFailed('Invalid request body', (validate.errors ?? []).map(toFieldError)))
    }

    // No cast needed. Ajv's validator is declared as a type guard, and returning early
    // on failure narrows `body` to `T` here by elimination.
    return ok(body)
  }
}

/**
 * The egress half. Same Ajv instance, same schema-is-the-source-of-truth shape, and one
 * deliberate difference: a response that does not satisfy its published schema is a bug
 * in this service rather than a mistake by the client, so it yields `Unexpected` — 500,
 * never anything in the 4xx range.
 *
 * WHAT IT IS FOR, which is not "symmetry with ingress". `additionalProperties: false` on
 * the response schemas is what turns section 3's "no persistence entity and no password
 * hash ever reaches a response body" into a checked property. A leaked `password_hash`
 * becomes a 500 instead of a disclosure.
 *
 * THE LOG CARRIES THE MISMATCH AND NOT THE BODY, and that is a correction to the
 * reasoning in `errors.ts` rather than an oversight — see docs/divergences.md § Slice 2.
 * Ajv names the offending property and the keyword it failed; the value is exactly the
 * thing that must not be written down, because in the case this mechanism exists for it
 * is a password hash.
 */
export function responseValidatorFor<S extends object>(
  schema: S,
): (body: unknown) => Result<FromSchema<S & JSONSchema>, DomainError> {
  type T = FromSchema<S & JSONSchema>

  const validate = ajv.compile<T>(schema)

  return (body: unknown): Result<T, DomainError> => {
    // The round trip is the mechanism, not a defensive copy, and it is in here rather
    // than at the call site so that no caller can validate the wrong thing. Ajv's type
    // checks are `typeof`-based, so a `Date` satisfies `type: 'object'` but fails
    // `type: 'string', format: 'date-time'`; `undefined` values and symbol keys are
    // dropped by `JSON.stringify` and never reach the client at all. Validating the
    // in-memory object checks something nobody will receive — measured, see
    // docs/divergences.md § Slice 2.
    const serialised: unknown = JSON.parse(JSON.stringify(body))

    if (!validate(serialised)) {
      const mismatches = (validate.errors ?? []).map(
        (error) => `${fieldOf(error)} ${error.message ?? 'is invalid'}`,
      )

      return err(
        unexpected(new Error('Response body failed its published schema'), { mismatches }),
      )
    }

    // The serialised form, so that what was checked is what gets sent.
    return ok(serialised)
  }
}
