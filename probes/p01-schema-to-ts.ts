// PROBE 01: does `json-schema-to-ts` still infer under the installed TypeScript?
// The brief's `isJsonValidRz` premise is "one JSON Schema drives both runtime
// validation and compile-time types". If FromSchema degrades to `any` or `unknown`,
// the whole validation story loses its compile-time half.
import type { FromSchema } from 'json-schema-to-ts'

const createUserRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'address', 'phoneNumber', 'email'],
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
    phoneNumber: { type: 'string' },
    email: { type: 'string', format: 'email' },
  },
} as const

type CreateUserRequest = FromSchema<typeof createUserRequest>

// If inference works, `name` is `string` and this assignment is an error.
const check: CreateUserRequest = {
  name: 123, // EXPECT: type error
  address: { line1: 'a', town: 't', county: 'c', postcode: 'p' },
  phoneNumber: '+447700900000',
  email: 'a@b.com',
}

// If inference works, `line2` is optional-string, not `any`.
const line2: string | undefined = check.address.line2
void line2

// EXPECT: error — `nope` is not a property of the inferred type
void check.nope
