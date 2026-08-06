import type { FromSchema } from 'json-schema-to-ts'
import type { ResultAsync } from 'neverthrow'

import type { DomainError } from '../domain/errors.js'
import { CURRENCY, toDecimal } from '../domain/money.js'
import type { createAccountSchema } from '../http/schemas.js'
import type { AccountRecord, AccountsRepository } from '../repo/accounts.js'
import { owned_resourceRz } from './ownership.js'

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
 * The specification enumerates exactly one sort code and one currency. Both are constants
 * rather than columns because a column that can only hold one value states a decision nobody
 * has taken; `migrations/003-accounts.ts` records the same choice from the schema's side, and
 * the response schema's `enum` is what fails loudly if either drifts.
 *
 * The currency moved to `src/domain/money.ts` when the transaction endpoints became a second
 * thing that renders it. The sort code stays here, because an account is the only thing that
 * has one.
 */
const SORT_CODE = '10-10-10'

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
   * The owner is a column here rather than the resource's own id, which is the one thing
   * that differs between this endpoint's authorisation and the user endpoint's — and it is
   * the difference that made `owned_resourceRz` worth extracting from two cases instead of
   * guessing at from one.
   */
  fetch_accountRzA: (authenticatedUserId, accountNumber) =>
    repo
      .find_accountByNumberRzA(accountNumber)
      .andThen((account) =>
        owned_resourceRz(account, (found) => found.userId, authenticatedUserId, 'Bank account'),
      )
      .map(toResponse),
})
