import type { Request, RequestHandler } from 'express'

import type { TransactionResponseBody, TransactionsService } from '../service/transactions.js'
import { authedHandler, type Success } from './handler.js'
import { transactionResponseSchema } from './response-schemas.js'
import { accountParamsSchema, createTransactionSchema, transactionParamsSchema } from './schemas.js'
import { validatorFor } from './validator-for.js'

const validateAccountParams = validatorFor(accountParamsSchema)
const validateTransactionParams = validatorFor(transactionParamsSchema)
const validateCreateTransaction = validatorFor(createTransactionSchema)

/**
 * Two ingress checks rather than one, and the path is validated before the body: the account
 * number decides which resource the request is about, and a body that is fine for a resource
 * the caller did not name is not fine. Both answer 400, so the order is legible rather than
 * load-bearing — it is the reading order, not a precedence rule.
 */
export const createTransaction = (transactions: TransactionsService): RequestHandler =>
  authedHandler(transactionResponseSchema, (authenticatedUserId: string, req: Request) =>
    validateAccountParams(req.params).asyncAndThen((params) =>
      validateCreateTransaction(req.body).asyncAndThen((body) =>
        transactions
          .record_transactionRzA(authenticatedUserId, params.accountNumber, body)
          .map((transaction): Success<TransactionResponseBody> => ({ status: 201, body: transaction })),
      ),
    ),
  )

export const fetchTransaction = (transactions: TransactionsService): RequestHandler =>
  authedHandler(transactionResponseSchema, (authenticatedUserId: string, req: Request) =>
    validateTransactionParams(req.params).asyncAndThen((params) =>
      transactions
        .fetch_transactionRzA(authenticatedUserId, params.accountNumber, params.transactionId)
        .map((transaction): Success<TransactionResponseBody> => ({ status: 200, body: transaction })),
    ),
  )
