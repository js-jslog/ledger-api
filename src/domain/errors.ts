/**
 * EPHEMERAL. This module is replaced wholesale by the error-envelope slice, and
 * nothing should be built on the assumption that it will look like this.
 *
 * The validation funnel needs an error channel to exist before the error design
 * does, so this is the smallest union that lets it compile. The real one closes over
 * the whole status taxonomy, gives each member a constructor that logs at
 * construction, carries a correlation id, and is consumed by a single renderer the
 * compiler proves total. None of that is here.
 *
 * Growing this union is safe: nothing about its size constrains anything else.
 */

/** One entry in the `details` array the specification requires on a 400. */
export type FieldError = {
  readonly field: string
  readonly message: string
  readonly type: string
}

export type ValidationFailed = {
  readonly kind: 'ValidationFailed'
  readonly details: readonly FieldError[]
}

export type DomainError = ValidationFailed

export const validationFailed = (details: readonly FieldError[]): ValidationFailed => ({
  kind: 'ValidationFailed',
  details,
})
