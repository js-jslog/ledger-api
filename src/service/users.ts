import type { FromSchema } from 'json-schema-to-ts'
import { err, ok, type ResultAsync } from 'neverthrow'

import { forbidden, notFound, type DomainError } from '../domain/errors.js'
import { newUserId } from '../domain/ids.js'
import { hash_passwordRzA } from '../domain/password.js'
import type { createUserSchema } from '../http/schemas.js'
import type { UserRecord, UsersRepository } from '../repo/users.js'

export type CreateUserBody = FromSchema<typeof createUserSchema>

export type UsersService = {
  readonly signup_userRzA: (body: CreateUserBody) => ResultAsync<UserResponseBody, DomainError>
  readonly fetch_userRzA: (
    authenticatedUserId: string,
    userId: string,
  ) => ResultAsync<UserResponseBody, DomainError>
}

export type UserResponseBody = {
  readonly id: string
  readonly name: string
  readonly address: UserRecord['address']
  readonly phoneNumber: string
  readonly email: string
  readonly createdTimestamp: Date
  readonly updatedTimestamp: Date
}

const toResponse = (user: UserRecord): UserResponseBody => ({
  id: user.id,
  name: user.name,
  address: user.address,
  phoneNumber: user.phoneNumber,
  email: user.email,
  createdTimestamp: user.createdAt,
  updatedTimestamp: user.updatedAt,
})

/**
 * Hash, then insert. The order matters for a reason that is not performance: the
 * plaintext password never travels further than this function, and the repository port
 * takes a `passwordHash` rather than a password, so there is no signature through which
 * a plaintext could reach the database.
 */
export const usersService = (repo: UsersRepository): UsersService => ({
  signup_userRzA: (body) =>
    hash_passwordRzA(body.password)
      .andThen((passwordHash) =>
        repo.create_userRzA({
          id: newUserId(),
          name: body.name,
          address: body.address,
          phoneNumber: body.phoneNumber,
          email: body.email,
          passwordHash,
        }),
      )
      .map(toResponse),

  /**
   * RESOLVE, THEN AUTHORISE, AND THE ORDER IS THE WHOLE OF IT.
   *
   * Look the resource up first; answer 404 if it is not there; only then compare its owner
   * against the authenticated identity and answer 403 if it belongs to someone else. The
   * requirements name both statuses for this endpoint as separate scenarios, so this is
   * transcription rather than judgement — `coding-test.txt`, "Fetch a user".
   *
   * THE REVERSED ORDER IS THE MISTAKE THIS COMMENT EXISTS FOR, because it is invisible.
   * Comparing `userId` against the token before going to the database is one string
   * comparison, it never touches Postgres, and it answers 403 to a `userId` that does not
   * exist — where the requirements say 404. Every happy-path test still passes, and so does
   * the foreign-user test. Only the non-existent-user case tells them apart, which is why
   * that test is not optional here.
   *
   * A USER OWNS ITSELF, AND THAT IS NOT A DEGENERATE CASE. `ownerId` happens to be `id`,
   * but the shape is the general one — resolve, 404, compare, 403 — and the account
   * endpoint instantiates it with a real owner column. Written out concretely here because
   * one instance cannot show which parts of a pattern are general and which are incidental;
   * the extraction follows the second case rather than this one.
   *
   * WHAT THIS LEAKS IS CHOSEN RATHER THAN OVERLOOKED. Answering 404 for an absent user and
   * 403 for a foreign one tells any authenticated caller which user ids exist. Collapsing
   * both to 404 would close that and is the usual advice; it also contradicts a written
   * scenario, and section 3 says the specification's 403/404 semantics are followed exactly.
   * R41 records the leak, the alternative, and why it was not taken — so this is not a line
   * to tidy up.
   */
  fetch_userRzA: (authenticatedUserId, userId) =>
    repo.find_userByIdRzA(userId).andThen((user) => {
      if (user === undefined) {
        return err(notFound('User was not found'))
      }

      if (user.id !== authenticatedUserId) {
        return err(forbidden('You are not allowed to access this user'))
      }

      return ok(toResponse(user))
    }),
})
