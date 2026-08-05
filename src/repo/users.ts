import type { Kysely } from 'kysely'
import { ResultAsync } from 'neverthrow'

import { alreadyExists, unexpected, type DomainError } from '../domain/errors.js'
import type { Database } from '../db/schema.js'

export type Address = {
  readonly line1: string
  readonly line2?: string
  readonly line3?: string
  readonly town: string
  readonly county: string
  readonly postcode: string
}

export type NewUser = {
  readonly id: string
  readonly name: string
  readonly address: Address
  readonly phoneNumber: string
  readonly email: string
  readonly passwordHash: string
}

/**
 * What a caller gets back. It carries no `passwordHash`, which is the first of the two
 * mechanisms behind section 3's "no password hash ever reaches a response body": the
 * hash is write-only through this port, so a service cannot pass one on by accident.
 * Egress validation is the second, and it covers the case this one cannot — a caller
 * that goes around the port.
 */
export type UserRecord = {
  readonly id: string
  readonly name: string
  readonly address: Address
  readonly phoneNumber: string
  readonly email: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * The port. The service depends on this type and never on Kysely, so the column names,
 * the `null`-versus-absent question and the driver's error codes all stop here.
 */
export type UsersRepository = {
  readonly create_userRzA: (user: NewUser) => ResultAsync<UserRecord, DomainError>
}

/** The unique index in `migrations/002-users.ts`, matched by name below. */
const EMAIL_INDEX = 'users_email_lower_key'

/**
 * Insert and translate the violation, never check-then-insert: between a `select` and
 * an `insert` another request can take the address, so a check-first version answers
 * 201 twice for one email under exactly the load that makes it matter.
 *
 * The constraint name is matched rather than the code alone. `23505` means "some unique
 * constraint", and a future index on this table would otherwise start reporting itself
 * as a duplicate email — the same discipline section 4 requires of the account-number
 * retry loop.
 */
const isDuplicateEmail = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  cause.code === '23505' &&
  'constraint' in cause &&
  cause.constraint === EMAIL_INDEX

const toDomainError = (cause: unknown): DomainError =>
  isDuplicateEmail(cause)
    ? alreadyExists('A user already exists with the supplied email address')
    : unexpected(cause)

/**
 * `undefined` rather than `null` on the way back out. The column is nullable, so the
 * driver hands back `null`, and a `line2: null` is not what the published schema
 * describes — it says the property is absent.
 */
const optional = (value: string | null): string | undefined => value ?? undefined

export const usersRepository = (db: Kysely<Database>): UsersRepository => ({
  create_userRzA: (user) =>
    ResultAsync.fromPromise(
      db
        .insertInto('users')
        .values({
          id: user.id,
          name: user.name,
          address_line1: user.address.line1,
          address_line2: user.address.line2 ?? null,
          address_line3: user.address.line3 ?? null,
          address_town: user.address.town,
          address_county: user.address.county,
          address_postcode: user.address.postcode,
          phone_number: user.phoneNumber,
          email: user.email,
          password_hash: user.passwordHash,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
      toDomainError,
    ).map((row) => ({
      id: row.id,
      name: row.name,
      address: {
        line1: row.address_line1,
        line2: optional(row.address_line2),
        line3: optional(row.address_line3),
        town: row.address_town,
        county: row.address_county,
        postcode: row.address_postcode,
      },
      phoneNumber: row.phone_number,
      email: row.email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
})
