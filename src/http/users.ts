import type { Request, RequestHandler } from 'express'

import type { UserResponseBody, UsersService } from '../service/users.js'
import { publicHandler, type Success } from './handler.js'
import { userResponseSchema } from './response-schemas.js'
import { createUserSchema } from './schemas.js'
import { validatorFor } from './validator-for.js'

// Compiled once at module load rather than per request, like the response validator the
// adapter builds.
const validateCreateUser = validatorFor(createUserSchema)

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
