import type { FromSchema } from 'json-schema-to-ts'
import type { ResultAsync } from 'neverthrow'

import type { DomainError } from '../domain/errors.js'
import { newUserId } from '../domain/ids.js'
import { hash_passwordRzA } from '../domain/password.js'
import type { createUserSchema } from '../http/schemas.js'
import type { UserRecord, UsersRepository } from '../repo/users.js'
import { owned_resourceRz } from './ownership.js'

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
   * A USER OWNS ITSELF, WHICH IS WHY THE OWNER FUNCTION READS `id`. That is the only thing
   * this endpoint contributes to the shared decision; the order, both statuses and both
   * messages live in `owned_resourceRz`, which is also where the reason the order matters
   * is written down.
   *
   * WHAT THIS LEAKS IS CHOSEN RATHER THAN OVERLOOKED. Answering 404 for an absent user and
   * 403 for a foreign one tells any authenticated caller which user ids exist. Collapsing
   * both to 404 would close that and is the usual advice; it also contradicts a written
   * scenario, and section 3 says the specification's 403/404 semantics are followed exactly.
   * R41 records the leak, the alternative, and why it was not taken — so this is not a line
   * to tidy up.
   */
  fetch_userRzA: (authenticatedUserId, userId) =>
    repo
      .find_userByIdRzA(userId)
      .andThen((user) => owned_resourceRz(user, (found) => found.id, authenticatedUserId, 'User'))
      .map(toResponse),
})
