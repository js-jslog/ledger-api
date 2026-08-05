/**
 * Egress schemas — the published response bodies, validated on the way out.
 *
 * `additionalProperties: false` is doing a different job here from the one it does at
 * ingress. At ingress it closes mass assignment; here it is what turns section 3's "no
 * persistence entity and no password hash ever reaches a response body" from a
 * checklist item into a checked property. A leaked `password_hash` is a 500 rather than
 * a disclosure.
 */

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
