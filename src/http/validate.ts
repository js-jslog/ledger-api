import { Ajv, type ErrorObject } from 'ajv'
import addFormatsCjs from 'ajv-formats'
import { err, ok, type Result } from 'neverthrow'
import { validationFailed, type DomainError, type FieldError } from '../domain/errors.js'

/**
 * Stand-in for the brief's `isJsonValidRz`: Ajv behind a `Result`, so one JSON
 * Schema is the source of truth for both runtime validation and the compile-time
 * type. The real implementation is not available to this session; what matters
 * here is that the seam works and that a `Result` covers the ingress path
 * (§4, §14).
 *
 * ajv-formats is CJS whose dist does `module.exports = exports = formatsPlugin`,
 * while its .d.ts declares an ESM `export default`. Under nodenext + ESM,
 * TypeScript types the default import as the module NAMESPACE (not callable) but
 * Node hands you the function. `esModuleInterop` does not fix it because
 * `verbatimModuleSyntax` suppresses the synthesised interop. The types are wrong
 * about the runtime, so the cast has to say so.
 */
const addFormats = addFormatsCjs as unknown as (typeof addFormatsCjs)['default']

export const ajv = new Ajv({
  allErrors: true, // BadRequestErrorResponse.details is an array; report all of them
  strict: true, // catches the spec's malformed keywords instead of ignoring them
  coerceTypes: false, // "1000" must not become 1000 for a money field
  useDefaults: false,
  removeAdditional: false, // reject unknown keys, never silently strip them
})
addFormats(ajv)

/** Ajv's instancePath is a JSON Pointer; the spec's `details[].field` is a name. */
function toFieldError(e: ErrorObject): FieldError {
  const pointer = e.instancePath.replace(/^\//, '').replaceAll('/', '.')
  // For additionalProperties the offending key is in params, not the path --
  // instancePath would be "/address", which names the wrong field.
  const params = e.params as { additionalProperty?: string; missingProperty?: string }
  const field = params.additionalProperty ?? params.missingProperty ?? (pointer === '' ? 'body' : pointer)
  return { field, message: e.message ?? 'is invalid', type: e.keyword }
}

/**
 * Compiles a schema once, at module load, into a validator that narrows
 * `unknown` to `T` on the ok channel.
 *
 * NOTE ON THE SIGNATURE. The obvious shape is to infer the result type from the
 * schema:
 *
 *     function validator<const S extends JSONSchema>(schema: S):
 *       (body: unknown) => Result<FromSchema<S>, DomainError>
 *
 * That compiles in isolation and fails here, with TS2589 "type instantiation is
 * excessively deep" and TS2590 "union type too complex". The cause is the
 * multiplication: an unresolved `FromSchema<S>` over the whole `JSONSchema`
 * union, against the seven-member `DomainError` union, inside a `Result`.
 * Annotating the inner arrow's return type and supplying explicit type arguments
 * to `ok`/`err` each move the error but do not remove it.
 *
 * So the type parameter is named by the caller instead:
 *
 *     const validateCreateUser = validator<CreateUserBody>(createUserSchema)
 *
 * with `CreateUserBody = FromSchema<typeof createUserSchema>` declared once,
 * beside the schema. `FromSchema` is then only ever instantiated against a
 * concrete literal schema type, which is cheap. The single-source-of-truth
 * property is unchanged -- the shape is still written exactly once, in the schema
 * -- at the cost of naming the type at each call site, which is a readability
 * gain rather than a loss.
 */
export function validator<T>(schema: object): (body: unknown) => Result<T, DomainError> {
  const compiled = ajv.compile(schema)
  return (body: unknown): Result<T, DomainError> => {
    // §8: a text/plain or absent content-type leaves req.body undefined, not {}.
    // Ajv would report `must be object`, but keeping `undefined` away from the
    // schema entirely gives a clearer message and a 400 rather than a 500.
    if (body === undefined) {
      return err(
        validationFailed([{ field: 'body', message: 'Request body is required', type: 'required' }]),
      )
    }
    if (compiled(body)) return ok(body as T)
    return err(validationFailed((compiled.errors ?? []).map(toFieldError)))
  }
}
