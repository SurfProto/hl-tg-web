/**
 * Decimal string formatting for values sent to the exchange.
 *
 * These lived privately in order-validation.ts while client.ts carried its own
 * second copy of `truncateToDecimals` — the pre-362f6c8 version that could
 * round upwards. Sizes were fixed; prices went on using the broken one. One
 * implementation, in one place, is the point of this module.
 */

export function stripTrailingZeros(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '').replace(/\.$/u, '');
}

/**
 * Render a non-negative finite number in plain decimal notation, without
 * rounding. String(value) is the shortest representation that round-trips to the
 * same double, but it switches to exponential form for small magnitudes
 * (String(1e-8) === "1e-8"), which cannot be cut positionally.
 */
export function toPlainDecimal(value: number): string {
  const text = String(value);
  const exponentIndex = text.indexOf("e");
  if (exponentIndex === -1) return text;

  const exponent = Number(text.slice(exponentIndex + 1));
  const [integerPart, fractionPart = ""] = text.slice(0, exponentIndex).split(".");
  const digits = `${integerPart}${fractionPart}`;

  if (exponent < 0) {
    const zeros = "0".repeat(Math.max(0, -exponent - integerPart.length));
    return `0.${zeros}${digits}`;
  }

  const padding = "0".repeat(Math.max(0, exponent - fractionPart.length));
  const shifted = `${digits}${padding}`;
  const pointAt = integerPart.length + exponent;
  return pointAt >= shifted.length ? shifted : `${shifted.slice(0, pointAt)}.${shifted.slice(pointAt)}`;
}

/**
 * Truncate towards zero at `decimals` places. Must never round upwards.
 *
 * Two earlier approaches both did:
 *
 *  - Math.trunc((value + Number.EPSILON) * factor) / factor. Number.EPSILON is
 *    an absolute constant, so scaled by 10**decimals its effect depends on
 *    magnitude, and where it mattered it carried values sitting just below a lot
 *    boundary over it. formatOrderSize(0.00041999999999999996, {szDecimals: 5})
 *    returned "0.00042".
 *  - Cutting value.toFixed(20). toFixed rounds at the twentieth place, and for a
 *    value whose expansion runs to twenty-one digits ending in nines the
 *    rounding cascades: (0.000009999999999999999).toFixed(20) is
 *    "0.00001000000000000000", so a size below one lot became exactly one lot.
 *
 * Cutting the shortest round-trip representation is safe because that mapping is
 * injective — a double strictly below a lot boundary never prints as the
 * boundary, since the boundary's own string belongs to a different double.
 */
export function truncateToDecimals(value: number, decimals: number): string {
  const text = toPlainDecimal(value);
  const dot = text.indexOf(".");
  if (dot === -1) return decimals === 0 ? text : stripTrailingZeros(text);

  const cut = decimals === 0 ? text.slice(0, dot) : text.slice(0, dot + 1 + decimals);
  return decimals === 0 ? cut : stripTrailingZeros(cut);
}
