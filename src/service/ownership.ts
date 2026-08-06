import { err, ok, type Result } from 'neverthrow'

import { forbidden, notFound, type DomainError } from '../domain/errors.js'

/**
 * RESOLVE-THEN-AUTHORISE, IN ONE PLACE, BECAUSE IT IS THE DECISION NOTHING MECHANICAL
 * CHECKS.
 *
 * Every endpoint that reaches a resource by an id the client supplied has to answer the
 * same three-way question: is it there, does it belong to the caller, and only then may it
 * be returned. Getting the order wrong is the mistake worth designing against — comparing
 * the owner before the lookup is one string comparison that never touches the database, it
 * answers 403 for a resource nobody holds where the specification says 404, and it passes
 * every happy-path test. A shared function is *called*; a pattern is *reproduced*, and
 * reproduction is where that mistake enters.
 *
 * EXTRACTED FROM TWO CASES RATHER THAN ONE, and the difference between them is the whole
 * reason to wait. `GET /v1/users/{userId}` reads its owner from `id`, because a user owns
 * itself, and `GET /v1/accounts/{accountNumber}` reads it from `user_id`. With only the
 * first in hand, "the owner is the resource's own id" looks like part of the pattern rather
 * than an accident of it, and the second case would have had to bend around that. What the
 * two together show is that exactly one thing varies — which field carries the owner — so
 * that is the only thing this takes as a parameter beyond the resource itself.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a generic resource-endpoint factory, and not a wrapper
 * that also does the lookup. Each service still names its own repository call, its own
 * response mapping and its own route; what is shared is the authorisation decision alone.
 * A reader can still see a whole endpoint by reading one service method, which is worth
 * more than the four lines a wider abstraction would save.
 *
 * THE MESSAGES ARE DERIVED RATHER THAN PASSED, which is the one piece of mechanism here
 * that is not strictly forced. It buys a real property: a 403 and a 404 that are phrased
 * consistently across every resource cannot drift into one that says more than the other,
 * and saying more is how the pair stops being a status distinction and starts being an
 * oracle. The noun is written capitalised because lowercasing the first letter is safe
 * where capitalising it is not.
 */
export const owned_resourceRz = <T>(
  resource: T | undefined,
  ownerIdOf: (resource: T) => string,
  authenticatedUserId: string,
  resourceName: string,
): Result<T, DomainError> => {
  if (resource === undefined) {
    return err(notFound(`${resourceName} was not found`))
  }

  if (ownerIdOf(resource) !== authenticatedUserId) {
    return err(forbidden(`You are not allowed to access this ${resourceName.toLowerCase()}`))
  }

  return ok(resource)
}
