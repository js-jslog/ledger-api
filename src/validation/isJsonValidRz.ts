// `import Ajv from 'ajv'` fails to typecheck under module: nodenext +
// verbatimModuleSyntax (TS resolves the CJS default to the namespace object) even
// though it runs fine. The named class export satisfies both. ajv-formats has only
// a default export, so it needs the `.default` unwrap under the same settings.
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import addFormatsModule from 'ajv-formats'

const addFormats = addFormatsModule as unknown as (a: Ajv) => Ajv
import { err, ok, type Result } from 'neverthrow'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'

/**
 * Stand-in for the author's own `isJsonValidRz`. Same contract: one JSON Schema
 * drives Ajv at runtime and `FromSchema` at compile time, and the outcome is a
 * Result rather than a boolean-plus-mutable-error-property.
 *
 * Strict mode is deliberately ON. See PROBE 02 — it is what catches the supplied
 * spec's five uses of `format:` where `pattern:` was meant.
 */
const ajv = addFormats(new Ajv({ strict: true, allErrors: true }))

export interface FieldError { field: string; message: string; type: string }

const toFieldErrors = (errors: readonly ErrorObject[]): FieldError[] =>
  errors.map((e) => ({
    // additionalProperties reports the *parent* path, so name the offending key.
    field:
      e.keyword === 'additionalProperties'
        ? `${e.instancePath}/${String(e.params.additionalProperty)}`.replace(/^\//, '')
        : e.instancePath.replace(/^\//, '') || (e.params.missingProperty as string) || '(root)',
    message: e.message ?? 'is invalid',
    type: e.keyword,
  }))

export const compileValidator = <S extends JSONSchema>(schema: S) => {
  const validate: ValidateFunction = ajv.compile(schema as object)
  return (input: unknown): Result<FromSchema<S>, FieldError[]> =>
    validate(input)
      ? ok(input as FromSchema<S>)
      : err(toFieldErrors(validate.errors ?? []))
}
