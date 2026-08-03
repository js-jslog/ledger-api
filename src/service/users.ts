import bcrypt from 'bcryptjs'
import { err, ok, type Result } from 'neverthrow'
import type { Kysely, Selectable } from 'kysely'
import { randomBytes } from 'node:crypto'
import type { Database, UserTable } from '../db/schema.js'
import {
  alreadyExists,
  forbidden,
  notFound,
  unauthenticated,
  type DomainError,
} from '../domain/errors.js'
import type { CreateUserBody } from '../http/schemas.js'
import { issueToken } from '../auth/jwt.js'
import { UNIQUE_VIOLATION } from '../repo/account-numbers.js'

/**
 * The user-facing shape. §3: "No persistence entity and no password hash ever
 * reaches a response body." This type is the enforcement -- the row type and the
 * response type are different types, and the mapping function below is the only
 * bridge, so `password_hash` cannot travel by accident.
 */
export type UserResponse = {
  id: string
  name: string
  address: {
    line1: string
    line2?: string
    line3?: string
    town: string
    county: string
    postcode: string
  }
  phoneNumber: string
  email: string
  createdTimestamp: string
  updatedTimestamp: string
}

/**
 * Note what this function does NOT do: spread the row. `{ ...row, ... }` would
 * carry `password_hash` into the response the moment anyone stopped reading
 * carefully, and no test that checks the documented fields would catch it.
 */
function toResponse(row: Selectable<UserTable>): UserResponse {
  return {
    id: row.id,
    name: row.name,
    address: {
      line1: row.address_line1,
      // exactOptionalPropertyTypes: an absent optional property and one set to
      // undefined are different types, so these are spread in conditionally.
      ...(row.address_line2 === null ? {} : { line2: row.address_line2 }),
      ...(row.address_line3 === null ? {} : { line3: row.address_line3 }),
      town: row.address_town,
      county: row.address_county,
      postcode: row.address_postcode,
    },
    phoneNumber: row.phone_number,
    email: row.email,
    createdTimestamp: row.created_at.toISOString(),
    updatedTimestamp: row.updated_at.toISOString(),
  }
}

/** ^usr-[A-Za-z0-9]+$ per the spec. */
function newUserId(): string {
  return `usr-${randomBytes(8).toString('hex')}`
}

export function makeUserService(db: Kysely<Database>) {
  return {
    async create(body: CreateUserBody): Promise<Result<UserResponse, DomainError>> {
      // bcryptjs: pure JS, so `pnpm install` cannot break on a native build (§4).
      const passwordHash = await bcrypt.hash(body.password, 10)

      try {
        const row = await db
          .insertInto('users')
          .values({
            id: newUserId(),
            name: body.name,
            email: body.email.toLowerCase(), // the login identifier, so normalise it
            password_hash: passwordHash,
            address_line1: body.address.line1,
            address_line2: body.address.line2 ?? null,
            address_line3: body.address.line3 ?? null,
            address_town: body.address.town,
            address_county: body.address.county,
            address_postcode: body.address.postcode,
            phone_number: body.phoneNumber,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
        return ok(toResponse(row))
      } catch (e) {
        // §6: "email becomes the login identifier, so duplicate signup is now a
        // real path with no defined status. Add a unique constraint and a 409."
        // Caught from the constraint rather than pre-checked with a SELECT, which
        // would leave a race window between the check and the insert.
        if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
          return err(alreadyExists('Email'))
        }
        throw e
      }
    },

    /**
     * §4 keystone: ownership is checked here, in the service, against the
     * authenticated userId -- "not in middleware, not inferred from the path
     * parameter".
     *
     * Order matters and is dictated by the spec: fetch first, then compare. A
     * non-existent user is 404 even when the requester is asking about someone
     * else, and another user's id is 403 rather than 404. Reversing these two
     * checks would produce 403 for ids that do not exist, which leaks nothing but
     * contradicts the supplied scenarios.
     */
    async fetch(userId: string, authUserId: string): Promise<Result<UserResponse, DomainError>> {
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', userId)
        .executeTakeFirst()

      if (row === undefined) return err(notFound('User'))
      if (row.id !== authUserId) return err(forbidden())
      return ok(toResponse(row))
    },

    async login(email: string, password: string): Promise<Result<{ token: string }, DomainError>> {
      const row = await db
        .selectFrom('users')
        .select(['id', 'password_hash'])
        .where('email', '=', email.toLowerCase())
        .executeTakeFirst()

      // Unknown email and wrong password must be indistinguishable, and must take
      // comparable time -- otherwise the endpoint is a user-enumeration oracle.
      // bcrypt.compare against a dummy hash keeps the timing similar.
      const hash = row?.password_hash ?? DUMMY_HASH
      const matches = await bcrypt.compare(password, hash)

      if (row === undefined || !matches) return err(unauthenticated('bad credentials'))
      return ok({ token: issueToken(row.id) })
    },
  }
}

/** A real bcrypt hash of a value nobody will submit, for the timing-equalising path. */
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DvKkNaFYyZ0oCcKrjRVJUOaBLNAbG'

export type UserService = ReturnType<typeof makeUserService>
