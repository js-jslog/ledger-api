import { randomInt } from 'node:crypto'
import { err, ok, type Result } from 'neverthrow'
import type { Kysely } from 'kysely'
import { unexpected, type DomainError } from '../domain/errors.js'
import type { Database } from '../db/schema.js'

/**
 * Where account numbers come from.
 *
 * The brief never says. That is a gap rather than an oversight of mine: §9 puts
 * `POST /v1/accounts` in scope, the spec makes `accountNumber` the resource
 * identifier in four path templates, and it must match `^01\d{6}$`. So minting
 * one is a forced build item with a design decision inside it, and it is
 * unmentioned in §4's closed decisions.
 *
 * The keyspace is exactly 10^6: "01" then six free digits. That is small enough
 * that the collision behaviour has to be chosen deliberately.
 */

const KEYSPACE = 1_000_000

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = '23505'

export function randomAccountNumber(): string {
  // randomInt, not Math.random: account numbers are user-visible identifiers and
  // there is no reason to make them predictable.
  return `01${String(randomInt(0, KEYSPACE)).padStart(6, '0')}`
}

/**
 * Probability that n random draws from the keyspace contain at least one
 * collision — the birthday bound, used in the probe to put a number on the risk.
 */
export function collisionProbability(n: number): number {
  return 1 - Math.exp((-n * (n - 1)) / (2 * KEYSPACE))
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === UNIQUE_VIOLATION
}

/**
 * Insert-and-retry. The unique constraint on the primary key is the arbiter, so
 * there is no "check then insert" window — a concurrent creator cannot slip in
 * between.
 *
 * The alternative is a Postgres sequence (`01` + a zero-padded nextval), which
 * cannot collide at all. It is rejected here because it makes every account
 * number trivially guessable and leaks the bank's total account count, and
 * because it exhausts in order rather than degrading. Retry-on-conflict keeps the
 * numbers opaque; the cost is this loop, and the loop is bounded.
 */
export async function insertAccountWithNewNumber(
  db: Kysely<Database>,
  values: { userId: string; name: string },
  attempts = 5,
): Promise<Result<{ accountNumber: string }, DomainError>> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const accountNumber = randomAccountNumber()
    try {
      await db
        .insertInto('accounts')
        .values({
          account_number: accountNumber,
          user_id: values.userId,
          name: values.name,
          account_type: 'personal',
          balance_pennies: 0,
          currency: 'GBP',
        })
        .execute()
      return ok({ accountNumber })
    } catch (e) {
      // Only a collision is retryable. Anything else -- a foreign-key violation
      // from a deleted user, a check-constraint failure -- must propagate, or the
      // loop silently retries a request that can never succeed and then reports
      // the wrong error five attempts later.
      if (!isUniqueViolation(e)) throw e
    }
  }
  return err(unexpected(new Error(`could not allocate an account number in ${String(attempts)} attempts`)))
}
