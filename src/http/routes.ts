import express, { type Express, type Request } from 'express'
import { err, ok, type Result } from 'neverthrow'
import type { Kysely } from 'kysely'
import type { JSONSchema } from 'json-schema-to-ts'
import { bearerToken, verifyToken } from '../auth/jwt.js'
import type { Database } from '../db/schema.js'
import { validationFailed, type DomainError } from '../domain/errors.js'
import { makeAccountService } from '../service/accounts.js'
import { makeTransactionService } from '../service/transactions.js'
import { makeUserService } from '../service/users.js'
import { correlationMiddleware } from '../observability/correlation.js'
import { errorMiddleware, notFoundMiddleware } from './error-middleware.js'
import { created, handler, okBody } from './handler.js'
import { createTransactionSchema, createUserSchema } from './schemas.js'
import { isJsonValidRz } from './is-json-valid-rz.js'
import {
  bankAccountResponseSchema,
  listBankAccountsResponseSchema,
  listTransactionsResponseSchema,
  loginResponseSchema,
  transactionResponseSchema,
  userResponseSchema,
} from './response-schemas.js'

/**
 * Ingress validators are compiled once, at module load, not per request. Under
 * Ajv `strict: true` a malformed schema throws here -- at startup -- which is what
 * makes §6's spec defects impossible to ship.
 */
const validateCreateUser = isJsonValidRz(createUserSchema)
const validateCreateTransaction = isJsonValidRz(createTransactionSchema)

// These two were inline object literals passed straight to the validator with a
// hand-written type parameter beside them -- the same shape stated twice, with
// nothing keeping the statements in agreement. Hoisted so `as const` can apply:
// without it the literal types widen, `FromSchema` has nothing to infer from, and
// the validated body degrades to `unknown` with no error at all.
const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const satisfies JSONSchema
const validateLogin = isJsonValidRz(loginSchema)

const createAccountSchema = {
  type: 'object',
  required: ['name', 'accountType'],
  properties: {
    name: { type: 'string', minLength: 1 },
    accountType: { type: 'string', enum: ['personal'] },
  },
  additionalProperties: false,
} as const satisfies JSONSchema
const validateCreateAccount = isJsonValidRz(createAccountSchema)

/**
 * Authentication as a *function*, not middleware.
 *
 * §3 requires ownership checks in the service layer rather than middleware. The
 * same reasoning applies one step earlier: if authentication is middleware that
 * mutates `req`, every handler downstream has to trust that it ran, and the type
 * system cannot tell whether it did -- `req.userId` is either `string | undefined`
 * (so every handler needs a redundant check) or lied about as `string`.
 *
 * Returning a Result instead means a handler that wants the caller's identity has
 * to ask for it and deal with not getting it. There is no ambient state and
 * nothing to forget to register.
 */
function authenticate(req: Request): Result<string, DomainError> {
  return bearerToken(req.headers.authorization)
    .andThen(verifyToken)
    .map((payload) => payload.sub)
}

/** Path parameters are untrusted input too, and the spec gives them patterns. */
function pathParam(req: Request, name: string, pattern: RegExp): Result<string, DomainError> {
  // Express 5 types `req.params[name]` as `string | string[]`, because a route
  // can declare repeated or splat parameters. Passing an array to
  // `pattern.test()` would stringify it and sometimes match -- so the narrowing
  // is a real check, not a cast to satisfy the compiler.
  const raw: string | string[] | undefined = req.params[name]
  if (typeof raw !== 'string' || !pattern.test(raw)) {
    return err(
      validationFailed([{ field: name, message: `must match ${pattern.source}`, type: 'pattern' }]),
    )
  }
  return ok(raw)
}

const USER_ID = /^usr-[A-Za-z0-9]+$/
const ACCOUNT_NUMBER = /^01\d{6}$/
// §6 corrective 4: the spec's own `^tan-[A-Za-z0-9]$` is single-character and
// rejects its own `tan-123abc` example, so it would 400 every real request.
const TRANSACTION_ID = /^tan-[A-Za-z0-9]+$/

export function buildApp(db: Kysely<Database>): Express {
  const users = makeUserService(db)
  const accounts = makeAccountService(db)
  const transactions = makeTransactionService(db)

  const app = express()
  // First, before anything that can fail: a handler running outside the store
  // reads NO_REQUEST_CONTEXT and its records correlate with nothing.
  app.use(correlationMiddleware)
  app.use(express.json({ limit: '16kb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // ---- users -------------------------------------------------------------
  // The only unauthenticated write path.
  app.post(
    '/v1/users',
    handler(userResponseSchema, async (req) => {
      const body = validateCreateUser(req.body)
      if (body.isErr()) return err(body.error)
      return (await users.create(body.value)).map(created)
    }),
  )

  app.get(
    '/v1/users/:userId',
    handler(userResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      const userId = pathParam(req, 'userId', USER_ID)
      if (userId.isErr()) return err(userId.error)
      return (await users.fetch(userId.value, auth.value)).map(okBody)
    }),
  )

  // ---- auth --------------------------------------------------------------
  // §6 forced change 2: not in the supplied specification, but an explicit
  // deliverable of the exercise.
  app.post(
    '/v1/auth/login',
    handler(loginResponseSchema, async (req) => {
      const body = validateLogin(req.body)
      if (body.isErr()) return err(body.error)
      return (await users.login(body.value.email, body.value.password)).map(okBody)
    }),
  )

  // ---- accounts ----------------------------------------------------------
  app.post(
    '/v1/accounts',
    handler(bankAccountResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      const body = validateCreateAccount(req.body)
      if (body.isErr()) return err(body.error)
      return (await accounts.create(auth.value, body.value)).map(created)
    }),
  )

  app.get(
    '/v1/accounts',
    handler(listBankAccountsResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      return (await accounts.list(auth.value)).map(okBody)
    }),
  )

  app.get(
    '/v1/accounts/:accountNumber',
    handler(bankAccountResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      const accountNumber = pathParam(req, 'accountNumber', ACCOUNT_NUMBER)
      if (accountNumber.isErr()) return err(accountNumber.error)
      return (await accounts.fetch(accountNumber.value, auth.value)).map(okBody)
    }),
  )

  // ---- transactions ------------------------------------------------------
  app.post(
    '/v1/accounts/:accountNumber/transactions',
    handler(transactionResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      const accountNumber = pathParam(req, 'accountNumber', ACCOUNT_NUMBER)
      if (accountNumber.isErr()) return err(accountNumber.error)
      const body = validateCreateTransaction(req.body)
      if (body.isErr()) return err(body.error)
      return (await transactions.create(accountNumber.value, auth.value, body.value)).map(created)
    }),
  )

  app.get(
    '/v1/accounts/:accountNumber/transactions',
    handler(listTransactionsResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      const accountNumber = pathParam(req, 'accountNumber', ACCOUNT_NUMBER)
      if (accountNumber.isErr()) return err(accountNumber.error)
      return (await transactions.list(accountNumber.value, auth.value)).map(okBody)
    }),
  )

  app.get(
    '/v1/accounts/:accountNumber/transactions/:transactionId',
    handler(transactionResponseSchema, async (req) => {
      const auth = authenticate(req)
      if (auth.isErr()) return err(auth.error)
      const accountNumber = pathParam(req, 'accountNumber', ACCOUNT_NUMBER)
      if (accountNumber.isErr()) return err(accountNumber.error)
      const transactionId = pathParam(req, 'transactionId', TRANSACTION_ID)
      if (transactionId.isErr()) return err(transactionId.error)
      return (
        await transactions.fetch(accountNumber.value, transactionId.value, auth.value)
      ).map(okBody)
    }),
  )

  // §8: no path argument -- `app.use('*')` throws at startup under
  // path-to-regexp v8. Registered after every route, before the error handler.
  app.use(notFoundMiddleware)
  app.use(errorMiddleware)
  return app
}
