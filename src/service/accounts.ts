import type { FromSchema } from 'json-schema-to-ts'
import { err, ok, type ResultAsync } from 'neverthrow'

import { forbidden, notFound, type DomainError } from '../domain/errors.js'
import { toDecimal } from '../domain/money.js'
import type { createAccountSchema } from '../http/schemas.js'
import type { AccountRecord, AccountsRepository } from '../repo/accounts.js'

export type CreateAccountBody = FromSchema<typeof createAccountSchema>

export type AccountsService = {
  readonly open_accountRzA: (
    authenticatedUserId: string,
    body: CreateAccountBody,
  ) => ResultAsync<AccountResponseBody, DomainError>
  readonly fetch_accountRzA: (
    authenticatedUserId: string,
    accountNumber: string,
  ) => ResultAsync<AccountResponseBody, DomainError>
}

export type AccountResponseBody = {
  readonly accountNumber: string
  readonly sortCode: string
  readonly name: string
  readonly accountType: string
  readonly balance: number
  readonly currency: string
  readonly createdTimestamp: Date
  readonly updatedTimestamp: Date
}

/**
 * The two values the specification enumerates with exactly one member each. They are
 * constants rather than columns because a column that can only hold one value states a
 * decision nobody has taken; `migrations/003-accounts.ts` records the same choice from the
 * schema's side, and the response schema's `enum` is what fails loudly if either drifts.
 */
const SORT_CODE = '10-10-10'
const CURRENCY = 'GBP'

/**
 * The one place a balance stops being pennies. `toDecimal` is the inverse of the codebase's
 * only decimal→integer conversion, and confining it to this function is what keeps section
 * 3's "money never appears as a decimal inside the service boundary" true — everything
 * upstream of here, including the repository and the column, is an integer.
 */
const toResponse = (account: AccountRecord): AccountResponseBody => ({
  accountNumber: account.accountNumber,
  sortCode: SORT_CODE,
  name: account.name,
  accountType: account.accountType,
  balance: toDecimal(account.balance),
  currency: CURRENCY,
  createdTimestamp: account.createdAt,
  updatedTimestamp: account.updatedAt,
})

export const accountsService = (repo: AccountsRepository): AccountsService => ({
  /**
   * The owner is the authenticated user and is never taken from the request. There is no
   * `userId` on the ingress schema to take it from, which is the mechanism rather than the
   * discipline: opening an account in somebody else's name is unrepresentable here, not
   * merely rejected.
   */
  open_accountRzA: (authenticatedUserId, body) =>
    repo
      .create_accountRzA({
        userId: authenticatedUserId,
        name: body.name,
        accountType: body.accountType,
      })
      .map(toResponse),

  /**
   * The same four moves as `fetch_userRzA` in `src/service/users.ts`, and this is the second
   * real instance of them: resolve, 404 if absent, compare the owner, 403 if foreign.
   *
   * What differs from the first instance is only which field carries the owner — `userId`
   * here, `id` there, because a user owns itself. What does not differ is the order, and the
   * order is the part that is easy to get wrong invisibly: comparing before resolving
   * answers 403 for an account number nobody holds, where the specification says 404.
   */
  fetch_accountRzA: (authenticatedUserId, accountNumber) =>
    repo.find_accountByNumberRzA(accountNumber).andThen((account) => {
      if (account === undefined) {
        return err(notFound('Bank account was not found'))
      }

      if (account.userId !== authenticatedUserId) {
        return err(forbidden('You are not allowed to access this bank account'))
      }

      return ok(toResponse(account))
    }),
})
