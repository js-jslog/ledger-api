import type { FromSchema } from 'json-schema-to-ts'
import type { ResultAsync } from 'neverthrow'

import type { DomainError } from '../domain/errors.js'
import { newUserId } from '../domain/ids.js'
import { hash_passwordRzA } from '../domain/password.js'
import type { createUserSchema } from '../http/schemas.js'
import type { UserRecord, UsersRepository } from '../repo/users.js'

export type CreateUserBody = FromSchema<typeof createUserSchema>

export type UsersService = {
  readonly signup_userRzA: (body: CreateUserBody) => ResultAsync<UserResponseBody, DomainError>
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
})
