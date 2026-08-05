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
