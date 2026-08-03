import type { FromSchema } from 'json-schema-to-ts'

/**
 * Ingress schemas, derived from the supplied OpenAPI with §6's changes applied:
 *   - `password` added to CreateUserRequest (forced change 1)
 *   - `format:` keywords holding regexes rewritten as `pattern:` (forced change 3)
 *
 * `as const satisfies` rather than a bare `as const`: the `satisfies` half gives
 * an error at the schema definition if it is not a valid JSON Schema, while
 * `as const` is what preserves the literal types FromSchema needs. Losing either
 * silently degrades the inferred type to `unknown` or `Record<string, unknown>`.
 */

/** The spec's nested address object, shared by create and update. */
const addressSchema = {
  type: 'object',
  required: ['line1', 'town', 'county', 'postcode'],
  properties: {
    line1: { type: 'string', minLength: 1 },
    line2: { type: 'string' },
    line3: { type: 'string' },
    town: { type: 'string', minLength: 1 },
    county: { type: 'string', minLength: 1 },
    postcode: { type: 'string', minLength: 1 },
  },
  // §3: NOT inherited from the parent. Without it here,
  // { line1: "x", isAdmin: true } validates.
  additionalProperties: false,
} as const

export const createUserSchema = {
  type: 'object',
  required: ['name', 'address', 'phoneNumber', 'email', 'password'],
  properties: {
    name: { type: 'string', minLength: 1 },
    address: addressSchema,
    // Was `format: ^\+[1-9]\d{1,14}$` in the supplied spec -- a regex in a
    // `format` keyword, which means `pattern`. See §6 forced change 3.
    phoneNumber: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 12, maxLength: 72 },
  },
  additionalProperties: false,
} as const satisfies Record<string, unknown>

export type CreateUserBody = FromSchema<typeof createUserSchema>

export const createTransactionSchema = {
  type: 'object',
  required: ['amount', 'currency', 'type'],
  properties: {
    // `currencyScale` is a custom keyword; see probe 03. The spec's
    // "up to two decimal places" is otherwise unenforceable at the schema layer:
    // multipleOf: 0.01 rejects 15.7% of legal amounts and `pattern` is ignored
    // on numbers.
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 10000, currencyScale: 2 },
    currency: { type: 'string', enum: ['GBP'] },
    type: { type: 'string', enum: ['deposit', 'withdrawal'] },
    reference: { type: 'string', maxLength: 255 },
  },
  additionalProperties: false,
} as const satisfies Record<string, unknown>

export type CreateTransactionBody = FromSchema<typeof createTransactionSchema>

/**
 * The decoded JWT payload, validated as untrusted input (§3). `iat` and `exp`
 * must be declared or the payload fails its own `additionalProperties: false`,
 * because jsonwebtoken adds them at signing time.
 */
export const jwtPayloadSchema = {
  type: 'object',
  required: ['sub', 'iat', 'exp'],
  properties: {
    sub: { type: 'string', pattern: '^usr-[A-Za-z0-9]+$' },
    iat: { type: 'integer' },
    exp: { type: 'integer' },
  },
  additionalProperties: false,
} as const satisfies Record<string, unknown>

export type JwtPayload = FromSchema<typeof jwtPayloadSchema>
