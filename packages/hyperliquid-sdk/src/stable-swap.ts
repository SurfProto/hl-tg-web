import type { StableSwapAsset } from "@repo/types";

/**
 * The stable-swap decisions, extracted from hooks.ts.
 *
 * A swap moves a user's money between stablecoins by placing a real spot order,
 * so which market it picks and which side it takes is a trading decision, not
 * presentation. It lived among React hooks and could not be tested there.
 */

export type StableSpotMarket = {
  index: number;
  baseName: string;
  quoteName: string;
};

export type ResolvedStableSwapLeg = {
  coin: string;
  side: "buy" | "sell";
  marketName: string;
};

/** Hyperliquid accepts six decimals on a stablecoin transfer. */
const STABLE_TRANSFER_PRECISION = 1_000_000;

/** Round down, never up: the amount has to still be there when the order lands. */
export function roundStableAmount(amount: number): number {
  return (
    Math.floor(amount * STABLE_TRANSFER_PRECISION) / STABLE_TRANSFER_PRECISION
  );
}

export function formatStableAmount(amount: number): string {
  return roundStableAmount(amount)
    .toFixed(6)
    .replace(/\.?0+$/, "");
}

export function parseBalanceAmount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * What of a spot balance can actually be spent — total less whatever is held
 * against resting orders.
 */
export function getSpotAvailableBalance(
  spotBalance: unknown,
  coin: StableSwapAsset,
): number {
  const entry = (spotBalance as any)?.balances?.find(
    (balance: any) => balance.coin?.toUpperCase() === coin,
  );
  if (!entry) return 0;
  const total = parseBalanceAmount(entry.total);
  const hold = parseBalanceAmount(entry.hold);
  return Math.max(0, total - hold);
}

/**
 * The spot market and side that turn `fromAsset` into `toAsset`.
 *
 * Only one direction of a pair exists on the exchange, so a swap is a buy on
 * the market quoted in what is being spent, or a sell on the market based in
 * it. Getting this backwards would sell the asset the user wanted to keep.
 */
export function resolveStableSwapLeg(
  markets: StableSpotMarket[],
  fromAsset: StableSwapAsset,
  toAsset: StableSwapAsset,
): ResolvedStableSwapLeg {
  const buyLeg = markets.find(
    (market) =>
      market.baseName.toUpperCase() === toAsset &&
      market.quoteName.toUpperCase() === fromAsset,
  );
  if (buyLeg) {
    return {
      coin: `@${buyLeg.index}`,
      side: "buy",
      marketName: `${buyLeg.baseName}/${buyLeg.quoteName}`,
    };
  }

  const sellLeg = markets.find(
    (market) =>
      market.baseName.toUpperCase() === fromAsset &&
      market.quoteName.toUpperCase() === toAsset,
  );
  if (sellLeg) {
    return {
      coin: `@${sellLeg.index}`,
      side: "sell",
      marketName: `${sellLeg.baseName}/${sellLeg.quoteName}`,
    };
  }

  throw new Error(
    `No supported spot market found for ${fromAsset} -> ${toAsset}.`,
  );
}
