import express, { type NextFunction, type Request, type Response } from 'express'
import type { Kysely } from 'kysely'
import type { DB } from '../db/types.js'
import { accountView, makeService, type Service } from '../domain/service.js'
import { toPounds } from '../domain/money.js'
import { verify, type Principal } from '../domain/tokens.js'
import { toHttp } from './errorMapping.js'
import type { DomainError } from '../domain/errors.js'
import { compileValidator } from '../validation/isJsonValidRz.js'
import {
  accountNumberPattern, createAccountRequestSchema, createTransactionRequestSchema,
  createUserRequestSchema, loginRequestSchema, userIdPattern,
} from '../validation/schemas.js'
import type { TransactionRow, UserRow } from '../db/types.js'

const validateCreateUser = compileValidator(createUserRequestSchema)
const validateLogin = compileValidator(loginRequestSchema)
const validateCreateAccount = compileValidator(createAccountRequestSchema)
const validateCreateTransaction = compileValidator(createTransactionRequestSchema)

const send = (res: Response, e: DomainError): void => {
  const { status, body } = toHttp(e)
  res.status(status).json(body)
}

const userView = (row: UserRow) => ({
  id: row.id, name: row.name, address: row.address,
  phoneNumber: row.phone_number, email: row.email,
  createdTimestamp: row.created_timestamp.toISOString(),
  updatedTimestamp: row.updated_timestamp.toISOString(),
})

const transactionView = (row: TransactionRow) => ({
  id: row.id, amount: toPounds(row.amount_pence), currency: row.currency,
  type: row.type, reference: row.reference ?? undefined, userId: row.user_id,
  createdTimestamp: row.created_timestamp.toISOString(),
})

/** Authenticated request. Declared rather than mutating Express's Request type. */
interface Authed extends Request { principal?: Principal }

export const makeApp = (db: Kysely<DB>, jwtSecret: string) => {
  const service: Service = makeService(db, jwtSecret)
  const app = express()

  app.use(express.json({ limit: '64kb', strict: true }))

  const authenticate = (req: Authed, res: Response, next: NextFunction): void => {
    const header = req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      send(res, { kind: 'UNAUTHENTICATED', reason: 'MISSING' })
      return
    }
    const result = verify(header.slice('Bearer '.length), jwtSecret)
    if (result.isErr()) { send(res, result.error); return }
    req.principal = result.value
    next()
  }

  /** Every route body is wrapped so an unexpected throw becomes a mapped 500. */
  const handler =
    (fn: (req: Authed, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      fn(req as Authed, res).catch(next)
    }

  app.post('/v1/users', handler(async (req, res) => {
    const parsed = validateCreateUser(req.body)
    if (parsed.isErr()) { send(res, { kind: 'VALIDATION', details: parsed.error }); return }
    const created = await service.createUser(parsed.value)
    if (created.isErr()) { send(res, created.error); return }
    const user = await db.selectFrom('users').selectAll()
      .where('id', '=', created.value.id).executeTakeFirstOrThrow()
    res.status(201).json(userView(user))
  }))

  // SPEC DEVIATION: invented. The spec mandates bearer auth everywhere but never
  // defines how a token is obtained, and CreateUserRequest collects no credential.
  app.post('/v1/auth/login', handler(async (req, res) => {
    const parsed = validateLogin(req.body)
    if (parsed.isErr()) { send(res, { kind: 'VALIDATION', details: parsed.error }); return }
    const result = await service.login(parsed.value.email, parsed.value.password)
    if (result.isErr()) { send(res, result.error); return }
    res.status(200).json({ token: result.value.token, tokenType: 'Bearer', expiresIn: 3600 })
  }))

  app.get('/v1/users/:userId', authenticate, handler(async (req, res) => {
    const userId = req.params.userId as string
    if (!userIdPattern.test(userId)) { send(res, { kind: 'NOT_FOUND', resource: 'user' }); return }
    const result = await service.fetchUser(req.principal!, userId)
    if (result.isErr()) { send(res, result.error); return }
    res.status(200).json(userView(result.value))
  }))

  app.post('/v1/accounts', authenticate, handler(async (req, res) => {
    const parsed = validateCreateAccount(req.body)
    if (parsed.isErr()) { send(res, { kind: 'VALIDATION', details: parsed.error }); return }
    const result = await service.createAccount(req.principal!, parsed.value)
    if (result.isErr()) { send(res, result.error); return }
    res.status(201).json(accountView(result.value))
  }))

  app.get('/v1/accounts/:accountNumber', authenticate, handler(async (req, res) => {
    const acct = req.params.accountNumber as string
    if (!accountNumberPattern.test(acct)) { send(res, { kind: 'NOT_FOUND', resource: 'account' }); return }
    const result = await service.fetchAccount(req.principal!, acct)
    if (result.isErr()) { send(res, result.error); return }
    res.status(200).json(accountView(result.value))
  }))

  app.post('/v1/accounts/:accountNumber/transactions', authenticate, handler(async (req, res) => {
    const acct = req.params.accountNumber as string
    if (!accountNumberPattern.test(acct)) { send(res, { kind: 'NOT_FOUND', resource: 'account' }); return }
    const parsed = validateCreateTransaction(req.body)
    if (parsed.isErr()) { send(res, { kind: 'VALIDATION', details: parsed.error }); return }
    const result = await service.createTransaction(req.principal!, acct, parsed.value)
    if (result.isErr()) { send(res, result.error); return }
    res.status(201).json(transactionView(result.value))
  }))

  app.get('/v1/accounts/:accountNumber/transactions', authenticate, handler(async (req, res) => {
    const acct = req.params.accountNumber as string
    if (!accountNumberPattern.test(acct)) { send(res, { kind: 'NOT_FOUND', resource: 'account' }); return }
    const result = await service.listTransactions(req.principal!, acct)
    if (result.isErr()) { send(res, result.error); return }
    res.status(200).json({ transactions: result.value.map(transactionView) })
  }))

  // Deferred endpoints answer honestly rather than 404ing as if they don't exist.
  for (const [method, path] of [
    ['patch', '/v1/users/:userId'], ['delete', '/v1/users/:userId'],
    ['patch', '/v1/accounts/:accountNumber'], ['delete', '/v1/accounts/:accountNumber'],
  ] as const) {
    app[method](path, authenticate, (_req: Request, res: Response) => {
      send(res, { kind: 'NOT_IMPLEMENTED', operation: `${method.toUpperCase()} ${path}` })
    })
  }

  // Terminal error handler. Express 5 forwards async rejections here automatically.
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // A malformed JSON body arrives here as a SyntaxError from body-parser, not as a
    // validation failure, so without this branch it is a 500 instead of a 400.
    if (e instanceof SyntaxError && 'body' in e) {
      send(res, { kind: 'VALIDATION', details: [{ field: '(body)', message: 'is not valid JSON', type: 'json' }] })
      return
    }
    send(res, { kind: 'INTERNAL', detail: e instanceof Error ? e.message : String(e) })
  })

  return app
}
