/**
 * Format a USD price for display.
 *
 * Decimals are fixed per magnitude band and never stripped, so a price keeps
 * the same width as it ticks and a column of them lines up. The previous
 * version ran every result through parseFloat, which dropped trailing zeros:
 * 999.50 rendered as "$999.5" and 91.10 as "$91.1", so the same asset changed
 * width tick to tick. Prices at or above 1000 also had no minimum, so they
 * alternated between "$79,161" and "$79,161.4".
 *
 * Named apart from the SDK's formatPrice(rawPrice, market), which formats
 * against an asset's own tick size rather than by magnitude. Two exported
 * functions with the same name and different signatures is a poor thing to
 * have anywhere near money.
 *
 *   79161.4  → "$79,161.40"
 *   999.5    → "$999.50"
 *   91.15    → "$91.15"
 *   7.5548   → "$7.5548"
 *   0.09572  → "$0.09572"
 *   0.000012 → "$0.00001200"
 */
export function formatUsdPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '—';

  const decimals =
    price >= 10 ? 2
    : price >= 1 ? 4
    : price >= 0.01 ? 5
    : 8;

  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * The same price, split so a hero can set the whole and the fraction at
 * different sizes. Derived from formatUsdPrice rather than reimplementing the
 * bands, which is how the coin page's hero and its own tooltip came to
 * disagree about the same number.
 */
export function formatUsdPriceParts(price: number): { integer: string; decimal: string } {
  const formatted = formatUsdPrice(price);
  if (formatted === '—') return { integer: '0', decimal: '00' };

  const [integer, decimal = ''] = formatted.slice(1).split('.');
  return { integer, decimal };
}

/**
 * Format a coin size (base units) stripping trailing zeros.
 */
export function formatSize(size: number, szDecimals: number): string {
  return parseFloat(size.toFixed(Math.max(0, szDecimals))).toString();
}

/**
 * A position's size, where the asset's szDecimals is not at hand.
 *
 * Sizes arrive derived by float subtraction, so they carry binary dust
 * (0.30000000000000004); six decimals covers every szDecimals the exchange
 * lists and drops the dust. Lived on PositionsPage until the coin page had to
 * render the same number the same way.
 */
export function formatPositionSize(size: number): string {
  return String(parseFloat(size.toFixed(6)));
}

/** A dollar amount, unsigned — for margin and notional, never for PnL. */
export function formatUsd(value: number): string {
  return `$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * A PnL figure, always carrying its sign.
 *
 * The explicit minus matters: this used to return "$5" for a five-dollar loss,
 * leaving color as the only difference between winning and losing.
 */
export function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** A signed percentage, two decimals: return on equity, price change. */
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
