import type { MarketType, Order, OrderValidationResult } from '@repo/types';

export interface OrderValidationMarket {
  name: string;
  marketType: MarketType;
  minNotionalUsd: number;
  minBaseSize: number;
  szDecimals: number;
}

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

export function validateOrderInput(
  order: Order,
  market: OrderValidationMarket,
  referencePrice: number,
  availableBalance?: number,
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

  if (Number.isFinite(availableBalance) && availableBalance != null) {
    const requiredBalance = market.marketType === 'spot' ? order.sizeUsd : order.sizeUsd / leverage;
    if (requiredBalance > availableBalance) {
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
