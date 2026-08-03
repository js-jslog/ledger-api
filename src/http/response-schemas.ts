import type { JSONSchema } from 'json-schema-to-ts'

/**
 * Response schemas, for egress validation.
 *
 * DERIVED FROM THE SUPPLIED SPEC, WITH TWO CORRECTIONS THAT ARE NOT OPTIONAL.
 * Probe 08 established that the supplied response schemas are unsatisfiable in two
 * places, so validating against them verbatim would make the service return 500 on
 * entirely legal behaviour. Both corrections are recorded in FINDINGS.md F13 and
 * belong in the "changes to the supplied specification" write-up:
 *
 *   1. `balance` loses `maximum: 10000`. `amount` is capped at 10000 per
 *      transaction, so two legal deposits produce a balance the response schema
 *      cannot represent. There is no status code defined for refusing the second
 *      deposit, so the ceiling cannot be honoured without inventing one. Dropped
 *      here, deliberately, rather than turned into a 500.
 *   2. `TransactionResponse.id` becomes `^tan-[A-Za-z0-9]+$`. The supplied
 *      `^tan-[A-Za-z0-9]$` admits exactly one character after the prefix -- at most
 *      62 distinct ids -- and rejects the spec's own `tan-123abc` example.
 *
 * `additionalProperties: false` on every response object is doing more work here
 * than it does on ingress. On ingress it closes mass assignment; on egress it makes
 * §3's "no persistence entity and no password hash ever reaches a response body"
 * a *checked* property rather than a rule the mapping functions are trusted to
 * follow. A leaked `password_hash` becomes a 500 rather than a disclosure.
 */

const addressSchema = {
  type: 'object',
  required: ['line1', 'town', 'county', 'postcode'],
  properties: {
    line1: { type: 'string' },
    line2: { type: 'string' },
    line3: { type: 'string' },
    town: { type: 'string' },
    county: { type: 'string' },
    postcode: { type: 'string' },
  },
  additionalProperties: false,
} as const

export const userResponseSchema = {
  type: 'object',
  required: ['id', 'name', 'address', 'phoneNumber', 'email', 'createdTimestamp', 'updatedTimestamp'],
  properties: {
    id: { type: 'string', pattern: '^usr-[A-Za-z0-9]+$' },
    name: { type: 'string' },
    address: addressSchema,
    phoneNumber: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
    email: { type: 'string', format: 'email' },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema

export const bankAccountResponseSchema = {
  type: 'object',
  required: [
    'accountNumber',
    'sortCode',
    'name',
    'accountType',
    'balance',
    'currency',
    'createdTimestamp',
    'updatedTimestamp',
  ],
  properties: {
    accountNumber: { type: 'string', pattern: '^01\\d{6}$' },
    sortCode: { type: 'string', enum: ['10-10-10'] },
    name: { type: 'string' },
    accountType: { type: 'string', enum: ['personal'] },
    // Correction 1: no `maximum`. See the header comment.
    balance: { type: 'number', minimum: 0 },
    currency: { type: 'string', enum: ['GBP'] },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema

export const listBankAccountsResponseSchema = {
  type: 'object',
  required: ['accounts'],
  properties: { accounts: { type: 'array', items: bankAccountResponseSchema } },
  additionalProperties: false,
} as const satisfies JSONSchema

export const transactionResponseSchema = {
  type: 'object',
  required: ['id', 'amount', 'currency', 'type', 'createdTimestamp'],
  properties: {
    // Correction 2: `+` quantifier added.
    id: { type: 'string', pattern: '^tan-[A-Za-z0-9]+$' },
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 10000 },
    currency: { type: 'string', enum: ['GBP'] },
    type: { type: 'string', enum: ['deposit', 'withdrawal'] },
    reference: { type: 'string' },
    userId: { type: 'string', pattern: '^usr-[A-Za-z0-9]+$' },
    createdTimestamp: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema

export const listTransactionsResponseSchema = {
  type: 'object',
  required: ['transactions'],
  properties: { transactions: { type: 'array', items: transactionResponseSchema } },
  additionalProperties: false,
} as const satisfies JSONSchema

/** Not in the supplied spec -- added with the login endpoint (§6 forced change 2). */
export const loginResponseSchema = {
  type: 'object',
  required: ['token'],
  properties: { token: { type: 'string', minLength: 1 } },
  additionalProperties: false,
} as const satisfies JSONSchema
