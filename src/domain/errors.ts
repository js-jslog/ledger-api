/**
 * The closed union of domain failures.
 *
 * §8 of the brief: "one renderer, two sources". Domain failures arrive as the
 * error channel of a `Result`; infrastructure failures arrive through Express's
 * error middleware and are *translated* into this same union. Nothing else
 * renders an error envelope, which is what keeps the union closed.
 *
 * Each member carries only what the envelope needs, so the renderer is a total
 * function over this type and the compiler can prove it.
 */

/** One entry of the spec's `BadRequestErrorResponse.details` array. */
export type FieldError = {
  readonly field: string
  readonly message: string
  readonly type: string
}

export type DomainError =
  /** 400 — ingress schema rejected the request. The only error with `details`. */
  | { readonly kind: 'ValidationFailed'; readonly details: readonly FieldError[] }
  /** 401 — no bearer token, or one that does not verify. */
  | { readonly kind: 'Unauthenticated'; readonly detail: string }
  /** 403 — authenticated, resource exists, but is owned by someone else. */
  | { readonly kind: 'Forbidden' }
  /** 404 — no such resource, or not visible in the scope queried. */
  | { readonly kind: 'NotFound'; readonly resource: string }
  /** 409 — email already registered. Created by spec change 1 (§6). */
  | { readonly kind: 'AlreadyExists'; readonly resource: string }
  /** 422 — the expected outcome that is not an exception (§4). */
  | { readonly kind: 'InsufficientFunds' }
  /** 500 — translated from a throw. `cause` is logged, never rendered. */
  | { readonly kind: 'Unexpected'; readonly cause: unknown }

// Constructors. These exist so the `kind` strings are written once.
export const validationFailed = (details: readonly FieldError[]): DomainError => ({
  kind: 'ValidationFailed',
  details,
})
export const unauthenticated = (detail: string): DomainError => ({ kind: 'Unauthenticated', detail })
export const forbidden = (): DomainError => ({ kind: 'Forbidden' })
export const notFound = (resource: string): DomainError => ({ kind: 'NotFound', resource })
export const alreadyExists = (resource: string): DomainError => ({ kind: 'AlreadyExists', resource })
export const insufficientFunds = (): DomainError => ({ kind: 'InsufficientFunds' })
export const unexpected = (cause: unknown): DomainError => ({ kind: 'Unexpected', cause })
