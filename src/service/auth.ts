import type { FromSchema } from 'json-schema-to-ts'
import { errAsync, type ResultAsync } from 'neverthrow'

import { unauthenticated, type DomainError } from '../domain/errors.js'
import { DUMMY_HASH, verify_passwordRzA } from '../domain/password.js'
import { issue_tokenRzA } from '../domain/tokens.js'
import type { loginSchema } from '../http/schemas.js'
import type { UsersRepository } from '../repo/users.js'

export type LoginBody = FromSchema<typeof loginSchema>

export type TokenResponseBody = {
  readonly token: string
}

export type AuthService = {
  readonly login_tokenRzA: (body: LoginBody) => ResultAsync<TokenResponseBody, DomainError>
}

/**
 * Look up, compare, issue — and the comparison happens on both paths.
 *
 * An unknown email compares the supplied password against `DUMMY_HASH` and discards the
 * answer. That looks like wasted work and is the point: skipping it returns in under a
 * millisecond where a real account takes as long as bcrypt does, which turns this endpoint
 * into a user-enumeration oracle that no test of its status codes would notice. Adopted
 * from the reference, recorded at docs/divergences.md § Slice 2 so it would not have to be
 * rediscovered here.
 *
 * `credentials !== undefined` in the success branch is not redundant with `matched`. On the
 * unknown-email path `matched` is an answer about `DUMMY_HASH`, and a token must not be
 * issued on the strength of it whatever it says — there is no id to put in one.
 */
export const authService = (repo: UsersRepository): AuthService => ({
  login_tokenRzA: (body) =>
    repo.find_credentialsByEmailRzA(body.email).andThen((credentials) =>
      verify_passwordRzA(body.password, credentials?.passwordHash ?? DUMMY_HASH).andThen(
        (matched) =>
          matched && credentials !== undefined
            ? issue_tokenRzA(credentials.id).map((token) => ({ token }))
            : errAsync(unauthenticated({ reason: 'CredentialsRejected' })),
      ),
    ),
})
