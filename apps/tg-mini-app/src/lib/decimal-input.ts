/**
 * What an amount field will accept as it is typed.
 *
 * Returns the value to keep: `next` when the keystroke is allowed, `previous`
 * when it is not. **It rejects rather than reshapes.** Truncating or rounding a
 * number somebody is halfway through typing is how an order or a withdrawal
 * ends up for an amount they did not ask for — `truncateToDecimals` exists in
 * the SDK because a `toFixed` rounded 10.996 up to 11.00, which was more than
 * the account held, and the exchange refused it.
 *
 * The rules are the ones the trade screen's on-screen number pad used to
 * enforce by construction, before it was replaced with the device keyboard:
 *
 * - digits and at most one `.`, so no sign, exponent, whitespace or paste of
 *   arbitrary text;
 * - at most `maxDecimals` places;
 * - no leading zeros, so "05" is unreachable.
 *
 * Deliberately permissive in two places, matching the pad: `""` is a legal
 * state reachable by deleting, and a partial value like `"1."` is legal
 * mid-typing. Callers already parse with `parseFloat(x) || 0`, so neither
 * reaches a request as `NaN`.
 *
 * One case the pad could not reach: a `type="number"` input reports an
 * unparseable value such as `"1.2.3"` as `""`, so it clears the field rather
 * than being rejected. Harmless, and equivalent to a state the pad reached by
 * deleting.
 */
export function acceptDecimalInput(
  next: string,
  previous: string,
  maxDecimals: number,
): string {
  if (next === "") return "";
  if (!/^\d*\.?\d*$/u.test(next)) return previous;
  const decimals = next.split(".")[1] ?? "";
  if (decimals.length > maxDecimals) return previous;
  return next.replace(/^0+(?=\d)/u, "");
}
