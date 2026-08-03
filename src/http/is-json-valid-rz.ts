import { Ajv, type ErrorObject } from 'ajv'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import addFormatsCjs from 'ajv-formats'
import { err, ok, type Result } from 'neverthrow'
import { unexpected, validationFailed, type DomainError, type FieldError } from '../domain/errors.js'

/**
 * `isJsonValidRz` -- the single validation funnel. Ajv behind a `Result`, with the
 * type assertion performed inside the funnel rather than at the call site, so one
 * JSON Schema is the source of truth for both runtime validation and the
 * compile-time type. Every ingress path passes through here, and (since part 3)
 * every egress body too.
 *
 * A stand-in for the reference implementation of the same name, which was not
 * available to this session. Note the shape: this is a *factory* -- it compiles a
 * schema once and returns the validating function -- so the name reads more like a
 * predicate than it behaves. Kept as-is so the code and the brief agree.
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

/**
 * `currencyScale: 2` -- "at most two decimal places".
 *
 * This has to live here, beside the Ajv instance, and it has to run before any
 * module-level schema constant is compiled. Registering it in a test file instead
 * (which is where it started) makes the production path throw at startup:
 *
 *     Error: strict mode: unknown keyword: "currencyScale"
 *
 * That is the good failure -- `strict: true` refuses to compile a schema with a
 * keyword it does not know, rather than ignoring it and silently accepting 3dp
 * amounts. But it is a real ordering dependency in the composition root.
 *
 * See FINDINGS.md F6 for why the arithmetic is `round-then-check-slack` and not
 * `multipleOf: 0.01` (which rejects 15.7% of legal amounts) or
 * `Number.isInteger(x * 100)` (13.1%).
 */
ajv.addKeyword({
  keyword: 'currencyScale',
  type: 'number',
  schemaType: 'number',
  validate: (scale: number, data: number) => {
    const factor = 10 ** scale
    return Math.abs(data * factor - Math.round(data * factor)) <= 1e-6
  },
})

/**
 * Egress validation: does what the service is about to send actually satisfy the
 * schema the specification publishes for it?
 *
 * THE TRAP THAT MAKES THIS MORE THAN A COPY OF THE INGRESS PATH. Ajv's type checks
 * are `typeof`-based, so a `Date` instance satisfies `type: 'object'` but fails
 * `type: 'string', format: 'date-time'` — and a database row can carry `undefined`
 * values and class instances that `JSON.stringify` silently drops or transforms.
 * Validating the in-memory object therefore checks something the client will never
 * receive. So this validates the **serialised** form, via a JSON round trip.
 *
 * That round trip is a real cost — every response is serialised twice. At this
 * scale it is worth paying for the guarantee; at real traffic it would be gated to
 * non-production, and that gate is the sort of thing worth deciding once rather
 * than discovering.
 *
 * A FAILURE IS NOT A CLIENT ERROR. A response that does not satisfy its published
 * schema is a bug in the service, so this yields `Unexpected` — a 500 with the
 * mismatch in the log record — rather than anything in the 4xx range.
 */
export function egressCheck(schema: object): (body: unknown) => Result<void, DomainError> {
  const compiled = ajv.compile(schema)
  return (body: unknown): Result<void, DomainError> => {
    // The JSON round trip is the point, not a defensive copy.
    const serialised: unknown = JSON.parse(JSON.stringify(body))
    if (compiled(serialised)) return ok(undefined)
    const errors = compiled.errors ?? []
    return err(
      unexpected(new Error('response body does not satisfy its published schema'), {
        details: errors.map(toFieldError),
        schemaPaths: errors.map((e) => e.schemaPath),
        payload: serialised,
      }),
    )
  }
}

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
 * Compiles a schema once, at module load, into a validator that narrows `unknown`
 * to the schema's own inferred type on the ok channel.
 *
 * THE POINT OF THE SIGNATURE. The asserted type is *derived* from the schema
 * argument, so there is no second place to state the shape and therefore no way
 * to state it differently. The earlier shape here was
 * `validator<T>(schema: object)`, which left the two independent — and
 * `validator<CreateTransactionBody>(createUserSchema)` typechecked cleanly. That
 * mismatched assertion is now unrepresentable rather than something review has to
 * catch.
 *
 * WHY `S extends object` AND NOT `S extends JSONSchema`. Constraining to
 * `JSONSchema` and returning `FromSchema<S>` fails with TS2589 "type
 * instantiation is excessively deep" and TS2590 "union type too complex", because
 * an unresolved `FromSchema<S>` gets distributed across the whole `JSONSchema`
 * union and multiplied by the `DomainError` union inside `Result`. Constraining to
 * `object` leaves no union to distribute over, and the intersection is applied at
 * the instantiation site instead. Verified: project-wide `tsc --noEmit` is clean
 * with no explicit type argument at any of the five call sites, and typecheck wall
 * time is unchanged. See FINDINGS.md F7.
 *
 * THE HAZARD THIS CREATES. Inference depends on the schema being `as const`.
 * Without it the literal types are widened, `FromSchema` has nothing to work from,
 * and the body degrades to `unknown` **silently** — no error, just a validated
 * body you cannot read. The `as const` in `schemas.ts` is therefore load-bearing,
 * not advisory. `probe/03-validation/types.test.ts` asserts each validated body is
 * not `unknown` precisely because the compiler will not.
 *
 * THE FALLBACK, IF A FUTURE TYPESCRIPT REINTRODUCES THE BLOWUP. Retreat to
 * `isJsonValidRz<FromSchema<typeof createUserSchema>>(createUserSchema)`, which
 * also compiles here. It does not make a mismatch a type error, but it at least
 * keeps the type textually adjacent to the schema it was derived from.
 */
export function isJsonValidRz<S extends object>(
  schema: S,
): (body: unknown) => Result<FromSchema<S & JSONSchema>, DomainError> {
  type T = FromSchema<S & JSONSchema>
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
    const errors = compiled.errors ?? []
    return err(
      validationFailed(errors.map(toFieldError), {
        // The full payload goes to the log, keyed by correlation id. What protects
        // it is the response boundary, not redaction: renderError sends only the
        // spec's {field, message, type} details, never this and never schemaPath.
        payload: body,
        // schemaPath is the more useful of Ajv's two paths for debugging, and the
        // one that must not be rendered -- it exposes schema structure.
        schemaPaths: errors.map((e) => e.schemaPath),
      }),
    )
  }
}
