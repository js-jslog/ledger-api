/**
 * The decimal/pennies boundary.
 *
 * §3: "Money never appears as a decimal anywhere inside the service boundary."
 * The spec's wire format is a JSON number with up to two decimal places, so this
 * module is the only place a decimal amount is allowed to exist, and it converts
 * in both directions.
 *
 * See FINDINGS.md F6 for why the arithmetic is written this way rather than as
 * `Number.isInteger(amount * 100)`, which wrongly rejects 131,256 of the
 * 1,000,001 legal amounts.
 */

/** Slack large enough to absorb double representation error, far below half a penny. */
const TOLERANCE = 1e-6

/**
 * Decimal pounds to integer pennies. Returns null if the value carries more
 * precision than two decimal places, or is not a finite number.
 */
export function toPennies(amount: number): number | null {
  if (!Number.isFinite(amount)) return null
  const scaled = amount * 100
  const pennies = Math.round(scaled)
  if (Math.abs(scaled - pennies) > TOLERANCE) return null
  // Math.round(-0 * 100) is -0, and Object.is(-0, 0) is false.
  return pennies === 0 ? 0 : pennies
}

/**
 * Integer pennies back to the decimal the spec puts on the wire.
 *
 * `pennies / 100` is exact enough to round-trip every value in range, but it
 * produces `10.1` rather than `10.10` — which is correct, because JSON numbers
 * have no notion of trailing zeros. A client wanting two decimal places formats
 * on display; the spec's type is `number`, so emitting a string here would
 * violate it.
 */
export function toDecimal(pennies: number): number {
  return pennies / 100
}
