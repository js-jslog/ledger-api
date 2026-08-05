import type { Request, RequestHandler } from 'express'

import type { AccountResponseBody, AccountsService } from '../service/accounts.js'
import { authedHandler, type Success } from './handler.js'
import { accountResponseSchema } from './response-schemas.js'
import { accountParamsSchema, createAccountSchema } from './schemas.js'
import { validatorFor } from './validator-for.js'

const validateCreateAccount = validatorFor(createAccountSchema)
const validateAccountParams = validatorFor(accountParamsSchema)

export const createAccount = (accounts: AccountsService): RequestHandler =>
  authedHandler(accountResponseSchema, (authenticatedUserId: string, req: Request) =>
    validateCreateAccount(req.body).asyncAndThen((body) =>
      accounts
        .open_accountRzA(authenticatedUserId, body)
        .map((account): Success<AccountResponseBody> => ({ status: 201, body: account })),
    ),
  )

export const fetchAccount = (accounts: AccountsService): RequestHandler =>
  authedHandler(accountResponseSchema, (authenticatedUserId: string, req: Request) =>
    validateAccountParams(req.params).asyncAndThen((params) =>
      accounts
        .fetch_accountRzA(authenticatedUserId, params.accountNumber)
        .map((account): Success<AccountResponseBody> => ({ status: 200, body: account })),
    ),
  )
