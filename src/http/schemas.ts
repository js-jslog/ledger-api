/**
 * Ingress schemas. Hand-written rather than lifted from `openapi.yaml`: the supplied
 * document is OpenAPI 3.1, whose schema objects are JSON Schema 2020-12, while the
 * default `ajv` import is draft-07 — a lifted schema carrying `$schema` throws at
 * compile time. Hand-writing also means `additionalProperties: false` is present by
 * construction rather than by remembering to add it.
 *
 * `as const` is not decoration. Without it `FromSchema` degrades to `unknown`
 * silently — no error, no warning — which is why `validator-for.type-assertions.ts`
 * asserts that a validated body is never `unknown`.
 */

/**
 * `additionalProperties: false` appears twice, and the nested one is the one that
 * matters: it is not inherited, so without it `{ line1: "x", isAdmin: true }`
 * validates against the address.
 */
export const createUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'address', 'phoneNumber', 'email', 'password'],
  properties: {
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
    // `maxLength` is an addition to the published document, and it is not tidiness:
    // bcrypt hashes the first 72 bytes and silently ignores the rest, so without it a
    // 100-character password authenticates against the hash of its first 72. Accepting
    // input the service does not honour is the objection, not the entropy. R36 records
    // what this does not close.
    password: { type: 'string', minLength: 12, maxLength: 72 },
  },
} as const

/**
 * The fourth ingress point, and the one that does not look like one: a decoded JWT payload
 * is input from whoever presented the token, so it goes through the same funnel as a
 * request body rather than being trusted because a signature checked out.
 *
 * `additionalProperties: false` is what gives the section 3 invariant its teeth, and the
 * mechanism is worth stating because it reads like a formality. jose puts `iat` and `exp`
 * into every token this service issues. So a schema that named only `sub` would reject
 * every valid token — the schema cannot omit a claim the service actually mints, because
 * omitting one fails closed and loudly rather than waving the claim through.
 */
export const tokenClaimsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sub', 'iat', 'exp'],
  properties: {
    sub: { type: 'string' },
    iat: { type: 'number' },
    exp: { type: 'number' },
  },
} as const

/**
 * `password` carries no `minLength` and no `maxLength`, and the asymmetry with signup is
 * deliberate rather than an omission. Enforcing the signup policy here turns a short
 * password into a 400 naming the minimum, where it owes an indistinguishable 401 — a
 * validation message is an oracle for the password policy, and this is the one endpoint
 * where that costs something. Recorded in docs/spec-changes.md § 2.
 *
 * `format: 'email'` stays, because it says nothing a caller does not already know about
 * their own input and it keeps the published schema honest.
 */
export const loginSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string' },
  },
} as const
