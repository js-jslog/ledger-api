/**
 * Egress schemas — the published response bodies, validated on the way out.
 *
 * `additionalProperties: false` is doing a different job here from the one it does at
 * ingress. At ingress it closes mass assignment; here it is what turns section 3's "no
 * persistence entity and no password hash ever reaches a response body" from a
 * checklist item into a checked property. A leaked `password_hash` is a 500 rather than
 * a disclosure.
 */

/**
 * `additionalProperties: false` is load-bearing here for the same reason as below, against
 * a different leak: the service that mints this body is one field away from the credential
 * row it authenticated against.
 */
export const tokenResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['token'],
  properties: {
    token: { type: 'string' },
  },
} as const

export const userResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'address',
    'phoneNumber',
    'email',
    'createdTimestamp',
    'updatedTimestamp',
  ],
  properties: {
    id: { type: 'string', pattern: '^usr-[A-Za-z0-9]+$' },
    name: { type: 'string' },
    address: {
      type: 'object',
      additionalProperties: false,
      required: ['line1', 'town', 'county', 'postcode'],
      properties: {
        line1: { type: 'string' },
        line2: { type: 'string' },
        line3: { type: 'string' },
        town: { type: 'string' },
        county: { type: 'string' },
        postcode: { type: 'string' },
      },
    },
    phoneNumber: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
    email: { type: 'string', format: 'email' },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
} as const

/**
 * `balance` is the one field here this schema does NOT protect, which is worth saying
 * plainly because the surrounding keywords invite the opposite assumption. The column holds
 * an integer count of pennies and this declares a decimal amount, but `type: 'number'`
 * accepts `1099` as readily as `10.99` — so a balance that reached the wire without
 * `toDecimal` is a hundredfold overstatement that validates. The only thing standing there
 * is a test with a non-zero balance in it, in `accounts.test.ts`.
 *
 * `minimum: 0` is the published constraint and is real, though it is not load-bearing until
 * money can leave an account; the invariant that will keep it true is `debitIfSufficient`'s.
 *
 * The `enum`s on `sortCode` and `currency` are what stand in for the columns this service
 * deliberately does not have. Both values are minted in `src/service/accounts.ts`, and a
 * typo there is a 500 here rather than a wrong sort code on the wire.
 */
export const accountResponseSchema = {
  type: 'object',
  additionalProperties: false,
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
    balance: { type: 'number', minimum: 0 },
    currency: { type: 'string', enum: ['GBP'] },
    createdTimestamp: { type: 'string', format: 'date-time' },
    updatedTimestamp: { type: 'string', format: 'date-time' },
  },
} as const
