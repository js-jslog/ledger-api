import { Ajv, type ErrorObject } from 'ajv'
import addFormatsCjs from 'ajv-formats'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { err, ok, type Result } from 'neverthrow'

import { validationFailed, type DomainError, type FieldError } from '../domain/errors.js'

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
        validationFailed([{ field: 'body', message: 'Request body is required', type: 'required' }]),
      )
    }

    if (!validate(body)) {
      return err(validationFailed((validate.errors ?? []).map(toFieldError)))
    }

    // No cast needed. Ajv's validator is declared as a type guard, and returning early
    // on failure narrows `body` to `T` here by elimination.
    return ok(body)
  }
}
