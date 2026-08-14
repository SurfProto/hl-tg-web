import type { MarketType, Order, OrderValidationResult } from '@repo/types';

export interface OrderValidationMarket {
  name: string;
  marketType: MarketType;
  minNotionalUsd: number;
  minBaseSize: number;
  szDecimals: number;
  /** Exchange cap. Orders above it are rejected upstream, so reject here too. */
  maxLeverage?: number;
}

/**
 * Headroom left for fees when checking an order against the available balance.
 *
 * Sizing to exactly the available balance leaves nothing for the builder fee or
 * the exchange taker fee, so the order passed local validation and was then
 * rejected by the exchange.
 */
const FEE_BUFFER_RATIO = 0.005;

function stripTrailingZeros(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '').replace(/\.$/u, '');
}

/**
 * Render a non-negative finite number in plain decimal notation, without
 * rounding. String(value) is the shortest representation that round-trips to the
 * same double, but it switches to exponential form for small magnitudes
 * (String(1e-8) === "1e-8"), which cannot be cut positionally.
 */
function toPlainDecimal(value: number): string {
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
function truncateToDecimals(value: number, decimals: number): string {
  const text = toPlainDecimal(value);
  const dot = text.indexOf(".");
  if (dot === -1) return decimals === 0 ? text : stripTrailingZeros(text);

  const cut = decimals === 0 ? text.slice(0, dot) : text.slice(0, dot + 1 + decimals);
  return decimals === 0 ? cut : stripTrailingZeros(cut);
}

/**
 * No real lot size needs more places than this, and the loop below has to stop
 * somewhere. Hyperliquid's own szDecimals top out well under it.
 */
const MAX_INFERRED_SZ_DECIMALS = 18;

/**
 * The number of decimal places a lot size occupies.
 *
 * Counting the digits of `minBaseSize.toString()` is only right when the double
 * is exactly the decimal it looks like. Reach one by arithmetic and it may not
 * be: `10 ** -5` is exactly 1e-5 on V8 in Node 24 but 1.0000000000000001e-5 on
 * Node 20, which prints twenty-one decimals. That number then became
 * szDecimals, and szDecimals is what formats the size sent to the exchange — so
 * float noise in a lot size turned into a twenty-one decimal order.
 *
 * Take the shortest decimal that still represents the same lot size instead.
 * Real lot sizes are decades apart, so a relative tolerance this tight cannot
 * merge two of them.
 */
export function inferSzDecimalsFromMinBaseSize(minBaseSize: number): number {
  if (!Number.isFinite(minBaseSize) || minBaseSize <= 0) return 0;

  for (let decimals = 0; decimals <= MAX_INFERRED_SZ_DECIMALS; decimals++) {
    const rounded = Number(minBaseSize.toFixed(decimals));
    if (Math.abs(rounded - minBaseSize) <= minBaseSize * 1e-9) {
      return decimals;
    }
  }

  return MAX_INFERRED_SZ_DECIMALS;
}

export function formatOrderSize(
  rawSize: number,
  market: Pick<OrderValidationMarket, 'name' | 'szDecimals'>,
): string {
  if (!Number.isFinite(rawSize) || rawSize <= 0) {
    throw new Error(`Invalid size for ${market.name}`);
  }

  const formatted = truncateToDecimals(rawSize, market.szDecimals);
  if (Number(formatted) <= 0) {
    throw new Error(`Order size is too small for ${market.name}`);
  }

  return formatted;
}

export interface ValidateOrderOptions {
  /**
   * Treat a missing or non-finite availableBalance as a validation failure.
   * Set this wherever the result gates a submit control.
   */
  requireBalance?: boolean;
}

export function validateOrderInput(
  order: Order,
  market: OrderValidationMarket,
  referencePrice: number,
  availableBalance?: number,
  options: ValidateOrderOptions = {},
): OrderValidationResult {
  const minSizeUsd = market.minNotionalUsd;
  const leverage = market.marketType === 'spot' ? 1 : Math.max(order.leverage ?? 1, 1);
  const minMarginUsd = market.marketType === 'spot'
    ? minSizeUsd
    : minSizeUsd / leverage;

  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: `Reference price unavailable for ${market.name}.`,
    };
  }

  if (!Number.isFinite(order.sizeUsd) || order.sizeUsd <= 0) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: 'Enter an order size greater than 0.',
    };
  }

  if (order.sizeUsd < minSizeUsd) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: `Minimum order value is $${minSizeUsd.toFixed(2)}.`,
    };
  }

  // The exchange caps leverage per market. Nothing checked it here, so an
  // out-of-range value made minMarginUsd and the balance check meaninglessly
  // small and the order failed at the exchange instead.
  if (
    market.marketType !== 'spot' &&
    market.maxLeverage != null &&
    Number.isFinite(market.maxLeverage) &&
    leverage > market.maxLeverage
  ) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: `Maximum leverage for ${market.name} is ${market.maxLeverage}x.`,
    };
  }

  const balanceKnown = availableBalance != null && Number.isFinite(availableBalance);

  // Callers that gate a submit button pass requireBalance so an unknown balance
  // is an explicit failure rather than a silently skipped check. The order
  // construction path inside the client has no balance to hand and relies on the
  // exchange's own margin check, so it leaves this off.
  if (options.requireBalance && !balanceKnown) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: 'Balance unavailable. Try again in a moment.',
    };
  }

  if (balanceKnown) {
    const requiredBalance = market.marketType === 'spot' ? order.sizeUsd : order.sizeUsd / leverage;
    if (requiredBalance * (1 + FEE_BUFFER_RATIO) > (availableBalance as number)) {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason: 'Insufficient balance for this order size.',
      };
    }
  }

  const rawSize = order.sizeUsd / referencePrice;
  if (rawSize < market.minBaseSize) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: `Order size is below the minimum lot size for ${market.name}.`,
    };
  }

  try {
    formatOrderSize(rawSize, market);
  } catch (error) {
    return {
      isValid: false,
      minMarginUsd,
      minSizeUsd,
      reason: error instanceof Error ? error.message : 'Order size is too small.',
    };
  }

  return {
    isValid: true,
    minMarginUsd,
    minSizeUsd,
  };
}
