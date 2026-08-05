import type { Request, RequestHandler } from 'express'

import type { UserResponseBody, UsersService } from '../service/users.js'
import { authedHandler, publicHandler, type Success } from './handler.js'
import { userResponseSchema } from './response-schemas.js'
import { createUserSchema, userParamsSchema } from './schemas.js'
import { validatorFor } from './validator-for.js'

// Compiled once at module load rather than per request, like the response validator the
// adapter builds.
const validateCreateUser = validatorFor(createUserSchema)
const validateUserParams = validatorFor(userParamsSchema)

/**
 * Unauthenticated, and it is the only endpoint that is: this is how a caller obtains
 * the identity every other endpoint checks.
 */
export const createUser = (users: UsersService): RequestHandler =>
  publicHandler(userResponseSchema, (req: Request) =>
    validateCreateUser(req.body).asyncAndThen((body) =>
      users
        .signup_userRzA(body)
        .map((user): Success<UserResponseBody> => ({ status: 201, body: user })),
    ),
  )

/**
 * The first authenticated route. `authenticatedUserId` is the `sub` claim of a verified
 * token, handed over by the adapter; `userId` is the path parameter the client asked about.
 * They are two different things that a shared name would blur, and the service compares
 * them — see `fetch_userRzA`, which owns the ownership decision.
 */
export const fetchUser = (users: UsersService): RequestHandler =>
  authedHandler(userResponseSchema, (authenticatedUserId: string, req: Request) =>
    validateUserParams(req.params).asyncAndThen((params) =>
      users
        .fetch_userRzA(authenticatedUserId, params.userId)
        .map((user): Success<UserResponseBody> => ({ status: 200, body: user })),
    ),
  )
