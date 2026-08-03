/**
 * Schemas derived from the supplied OpenAPI spec, with every deviation marked
 * `SPEC DEVIATION` so the gap register can be written from this file.
 */

const address = {
  type: 'object',
  additionalProperties: false,
  required: ['line1', 'town', 'county', 'postcode'],
  properties: {
    line1: { type: 'string', minLength: 1 },
    line2: { type: 'string' },
    line3: { type: 'string' },
    town: { type: 'string', minLength: 1 },
    county: { type: 'string', minLength: 1 },
    postcode: { type: 'string', minLength: 1 },
  },
} as const

export const createUserRequestSchema = {
  type: 'object',
  additionalProperties: false,
  // SPEC DEVIATION: `password` is added. The spec mandates JWT bearer auth on every
  // endpoint but CreateUserRequest collects no credential, so as written no user can
  // ever authenticate. Adding it is unavoidable; it must be declared in the spec.
  required: ['name', 'address', 'phoneNumber', 'email', 'password'],
  properties: {
    name: { type: 'string', minLength: 1 },
    address,
    // SPEC DEVIATION: spec says `format: ^\+[1-9]\d{1,14}$`. `format` is not
    // `pattern`; under Ajv strict mode that throws, and without it validates nothing.
    phoneNumber: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 12, maxLength: 256 },
  },
} as const

export const loginRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
} as const

export const createAccountRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'accountType'],
  properties: {
    name: { type: 'string', minLength: 1 },
    accountType: { type: 'string', enum: ['personal'] },
  },
} as const

export const createTransactionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'currency', 'type'],
  properties: {
    // SPEC DEVIATION: `exclusiveMinimum: 0` replaces `minimum: 0`. The spec permits a
    // zero-value transaction; the DB CHECK forbids it, so as written that pairing is
    // a 500. Penny precision is enforced separately — see PROBE 02 for why
    // `multipleOf: 0.01` cannot be used.
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 10000 },
    currency: { type: 'string', enum: ['GBP'] },
    type: { type: 'string', enum: ['deposit', 'withdrawal'] },
    reference: { type: 'string', maxLength: 140 },
  },
} as const

/** Path parameter schemas. Deliberately separate: a bad path param is a 404, not a 400. */
export const accountNumberPattern = /^01\d{6}$/
// SPEC DEVIATION: spec pattern `^tan-[A-Za-z0-9]$` matches one character only and
// rejects the spec's own example `tan-123abc`. `+` added.
export const transactionIdPattern = /^tan-[A-Za-z0-9]+$/
export const userIdPattern = /^usr-[A-Za-z0-9]+$/
