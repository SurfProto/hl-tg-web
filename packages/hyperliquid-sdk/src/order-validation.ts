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

function truncateToDecimals(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const truncated = Math.trunc((value + Number.EPSILON) * factor) / factor;
  return decimals === 0
    ? String(Math.trunc(truncated))
    : stripTrailingZeros(truncated.toFixed(decimals));
}

export function inferSzDecimalsFromMinBaseSize(minBaseSize: number): number {
  if (!Number.isFinite(minBaseSize) || minBaseSize <= 0) return 0;

  const normalized = stripTrailingZeros(minBaseSize.toString());
  if (normalized.includes('e-')) {
    const exponent = normalized.split('e-')[1];
    return exponent ? parseInt(exponent, 10) : 0;
  }

  const decimals = normalized.split('.')[1] ?? '';
  return decimals.length;
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
