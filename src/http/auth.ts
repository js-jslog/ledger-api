import type { Request, RequestHandler } from 'express'

import type { AuthService, TokenResponseBody } from '../service/auth.js'
import { publicHandler, type Success } from './handler.js'
import { tokenResponseSchema } from './response-schemas.js'
import { loginSchema } from './schemas.js'
import { validatorFor } from './validator-for.js'

const validateLogin = validatorFor(loginSchema)

/**
 * Unauthenticated, and the second and last endpoint that is: this is where a credential is
 * exchanged for the token every other route requires.
 */
export const login = (auth: AuthService): RequestHandler =>
  publicHandler(tokenResponseSchema, (req: Request) =>
    validateLogin(req.body).asyncAndThen((body) =>
      auth
        .login_tokenRzA(body)
        .map((token): Success<TokenResponseBody> => ({ status: 200, body: token })),
    ),
  )
