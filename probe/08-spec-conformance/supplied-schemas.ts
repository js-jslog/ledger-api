/**
 * Response schemas transcribed from the SUPPLIED openapi.yml, deliberately
 * unfixed except where Ajv cannot load them at all.
 *
 * The one unavoidable change is §6 forced item 3: the supplied document puts
 * regexes in `format:` keywords, which Ajv `strict: true` refuses to compile
 * (`unknown format`). Those are rewritten as `pattern:` with the *same regex
 * text* — including the defective ones — because the point of this probe is to
 * check our responses against the spec as written, not against a corrected spec.
 *
 * Everything else is verbatim, including `maximum: 10000.00` on `balance` and
 * the single-character `^tan-[A-Za-z0-9]$` on `TransactionResponse.id`.
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
} as const

export const suppliedUserResponse = {
  type: 'object',
  required: ['id', 'name', 'address', 'phoneNumber', 'email', 'createdTimestamp', 'updatedTimestamp'],
  properties: {
    id: { type: 'string', pattern: '^usr-[A-Za-z0-9]+$' }, // was `format:`
    name: { type: 'string' },
    address: addressSchema,
    phoneNumber: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' }, // was `format:`
    email: { type: 'string', format: 'email' },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
} as const

export const suppliedBankAccountResponse = {
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
    accountNumber: { type: 'string', pattern: '^01\\d{6}$' }, // was `format:`
    sortCode: { type: 'string', enum: ['10-10-10'] },
    name: { type: 'string' },
    accountType: { type: 'string', enum: ['personal'] },
    // VERBATIM. This is the constraint §6 files under "note, don't build".
    balance: { type: 'number', minimum: 0.0, maximum: 10000.0 },
    currency: { type: 'string', enum: ['GBP'] },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
} as const

export const suppliedTransactionResponse = {
  type: 'object',
  required: ['id', 'amount', 'currency', 'type', 'createdTimestamp'],
  properties: {
    // VERBATIM, and single-character: matches "tan-a" but not "tan-123abc",
    // which is the spec's own example.
    id: { type: 'string', pattern: '^tan-[A-Za-z0-9]$' },
    amount: { type: 'number', minimum: 0.0, maximum: 10000.0 },
    currency: { type: 'string', enum: ['GBP'] },
    type: { type: 'string', enum: ['deposit', 'withdrawal'] },
    reference: { type: 'string' },
    userId: { type: 'string', pattern: '^usr-[A-Za-z0-9]+$' }, // was `format:`
    createdTimestamp: { type: 'string', format: 'date-time' },
  },
} as const

/** The same schema with §6 corrective item 4 applied, for comparison. */
export const correctedTransactionResponse = {
  ...suppliedTransactionResponse,
  properties: {
    ...suppliedTransactionResponse.properties,
    id: { type: 'string', pattern: '^tan-[A-Za-z0-9]+$' }, // + quantifier added
  },
} as const
