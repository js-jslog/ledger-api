import { sql, type Kysely } from 'kysely'
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
 * hash cannot be reached through this type, so a service cannot pass one on by accident.
 * Egress validation is the second, and it covers the case this one cannot — a caller
 * that goes around the port.
 *
 * The port as a whole no longer withholds the hash — `Credentials` below exists because
 * login has to read it. The narrowing is what preserves the guarantee here: every caller
 * that builds a response body uses this type, and none of them can obtain that one.
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
 * The one shape that carries a hash back out, and it is deliberately not `UserRecord`.
 *
 * `UserRecord`'s comment above claims the hash is write-only through this port. Login has
 * to read it, so that claim cannot hold for the port as a whole any more — the choice is
 * where to spend the exception. Widening `UserRecord` spends it on every caller for the
 * benefit of one; a second type carrying nothing but what login needs spends it here, and
 * `UserRecord` keeps the property for everything else. There is no field on this type that
 * a response body has any use for.
 */
export type Credentials = {
  readonly id: string
  readonly passwordHash: string
}

/**
 * The port. The service depends on this type and never on Kysely, so the column names,
 * the `null`-versus-absent question and the driver's error codes all stop here.
 */
export type UsersRepository = {
  readonly create_userRzA: (user: NewUser) => ResultAsync<UserRecord, DomainError>
  readonly find_credentialsByEmailRzA: (
    email: string,
  ) => ResultAsync<Credentials | undefined, DomainError>
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

  /**
   * `lower(email)` on both sides, which is a forward obligation of storing the address as
   * submitted rather than normalising it on write — see docs/divergences.md § Slice 2.
   * Matching the raw column would fail to find anyone who typed a capital letter, and it
   * would fail as a 401 rather than as anything that looks like a bug. It is also what
   * lets the unique index in `migrations/002-users.ts` serve this lookup, since an
   * expression index answers the expression it was built on and nothing else.
   *
   * A missing row is `undefined` rather than an error. The service has to treat "no such
   * email" and "wrong password" identically, and a value it must not branch differently on
   * is easier to get right than an error channel it must remember to converge.
   */
  find_credentialsByEmailRzA: (email) =>
    ResultAsync.fromPromise(
      db
        .selectFrom('users')
        .select(['id', 'password_hash'])
        .where(sql<string>`lower(email)`, '=', email.toLowerCase())
        .executeTakeFirst(),
      unexpected,
    ).map((row) => (row === undefined ? undefined : { id: row.id, passwordHash: row.password_hash })),
})
