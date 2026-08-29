import type { OrderSide } from "@repo/types";

import { stripTrailingZeros, truncateToDecimals } from "./decimal";

/**
 * The price decisions on the order path, extracted from client.ts.
 *
 * Everything here decides what number reaches the exchange. It was private to
 * a 2,400-line class that also owns HTTP, signing and caching, so none of it
 * could be tested without standing up a client.
 */

export interface PriceMarket {
  name: string;
  /** Maximum decimal places the exchange accepts for this market's price. */
  priceDecimals: number;
}

/**
 * Hyperliquid caps a price at five significant figures — sent more, it rejects
 * the order — but exempts integer prices: 123456 is valid at six figures.
 */
export const MAX_PRICE_SIGNIFICANT_FIGURES = 5;

/**
 * How far through the book a market order is allowed to reach, as a fraction of
 * the mid price. Matches Hyperliquid's own SDK default. IOC cancels whatever
 * does not fill inside it, so this is the worst-case slippage.
 */
export const MARKET_ORDER_SLIPPAGE = 0.03;

/**
 * Keep at most `maxSignificant` significant digits, cutting rather than
 * rounding — the same direction as truncateToDecimals, for the same reason.
 *
 * Only fractional digits are ever cut. Integer digits all stay: the exchange
 * exempts integer prices from the significant-figure cap, and dropping one
 * would not shorten the price, it would divide it — "104256" cut to five
 * digits reads 10,425, a tenth of what the caller asked. This function used
 * to do exactly that, and the market-order path fed it every BTC-scale price:
 * buys capped a decade below the book could never fill, sells lost their
 * slippage floor, and a trigger at 110,000 was placed at 11,000.
 *
 * Leading zeros are not significant, so "0.00012345" keeps five digits after
 * them. A value with no integer part gains one: ".5" would not parse.
 */
export function limitSignificantFigures(
  value: string,
  maxSignificant: number,
): string {
  const [rawInteger = "", rawFraction = ""] = value.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/u, "") || "0";
  let significantDigits = integer === "0" ? 0 : integer.length;

  if (significantDigits >= maxSignificant) {
    return integer;
  }

  let fraction = "";
  let seenNonZero = significantDigits > 0;

  for (const char of rawFraction) {
    if (!seenNonZero && char === "0") {
      fraction += char;
      continue;
    }
    seenNonZero = true;

    if (significantDigits >= maxSignificant) break;
    significantDigits += 1;
    fraction += char;
  }

  return stripTrailingZeros(
    fraction === "" ? integer : `${integer}.${fraction}`,
  );
}

/**
 * The price string sent to the exchange: truncated to the market's decimals,
 * then to five significant figures.
 *
 * Both steps cut rather than round. client.ts used to truncate here with
 * `Math.trunc((value + Number.EPSILON) * factor) / factor`, the approach
 * 362f6c8 removed from the size path for carrying a value just below a
 * boundary over it. Sizes were fixed and prices were not, so a limit price
 * could come out one tick above what the caller asked for — on a buy, bidding
 * more than intended.
 */
export function formatPrice(rawPrice: number, market: PriceMarket): string {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    throw new Error(`Invalid price for ${market.name}`);
  }
  const truncated = truncateToDecimals(rawPrice, market.priceDecimals);
  const limited = limitSignificantFigures(
    truncated,
    MAX_PRICE_SIGNIFICANT_FIGURES,
  );
  if (limited === "0") {
    throw new Error(`Price rounded to zero for ${market.name}`);
  }
  return limited;
}

/**
 * The limit price that makes a "market" order cross the book.
 *
 * Buy above the mid, sell below it, by MARKET_ORDER_SLIPPAGE either way, so the
 * order takes any depth within that band and IOC cancels the rest.
 */
export function getAggressiveMarketPrice(
  midPrice: number,
  side: OrderSide,
): number {
  return side === "buy"
    ? midPrice * (1 + MARKET_ORDER_SLIPPAGE)
    : midPrice * (1 - MARKET_ORDER_SLIPPAGE);
}

/**
 * A price is only usable if it parses to a positive finite number. The exchange
 * sends them as strings, and sends nulls for markets with no trades yet.
 */
export function parsePositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The reference price implied by the top of the book, used when neither the
 * mid cache nor the asset context has one.
 *
 * One side alone still gives a price. A book with neither does not.
 */
export function orderbookMidpoint(
  bestBid: unknown,
  bestAsk: unknown,
): number | null {
  const bid = parsePositiveNumber(bestBid);
  const ask = parsePositiveNumber(bestAsk);

  if (bid != null && ask != null) return (bid + ask) / 2;
  return bid ?? ask ?? null;
}
