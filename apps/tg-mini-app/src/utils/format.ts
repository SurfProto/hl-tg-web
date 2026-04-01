/**
 * Format a price for display with up to 5 significant figures, no trailing zeros.
 *
 * Examples:
 *   68000    → "$68,000"
 *   83.3235  → "$83.32"
 *   0.09572  → "$0.09572"
 *   0.000012 → "$0.000012"
 */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '—';
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    // Strip trailing zeros, keep up to 4 decimal places
    return `$${parseFloat(price.toFixed(4))}`;
  }
  // For sub-$1 prices: enough decimal places to show ~5 significant figures.
  // e.g. 0.09572 → ceil(-log10(0.09572)) = ceil(1.02) = 2, +4 = 6 decimals → "0.095720" → parseFloat → "0.09572"
  const decimalPlaces = Math.max(2, Math.ceil(-Math.log10(price)) + 4);
  return `$${parseFloat(price.toFixed(decimalPlaces))}`;
}

/**
 * Format a coin size (base units) stripping trailing zeros.
 */
export function formatSize(size: number, szDecimals: number): string {
  return parseFloat(size.toFixed(Math.max(0, szDecimals))).toString();
}
