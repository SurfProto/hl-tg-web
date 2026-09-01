import type { Position } from '@repo/types';

/**
 * Coin symbols, and how a market on screen is matched to a position.
 *
 * Three forms of the same market circulate:
 *
 *   BTC                 an ordinary perp, bare
 *   xyz:GOLD-USDC       a HIP-3 market as the exchange names it — the form the
 *                       router carries and the form `position.coin` arrives in
 *   GOLD-USDC:xyz       the display form getMarketDisplayName produces
 *
 * A dex prefix is part of a market's identity, not decoration: `BTC` and
 * `xyz:BTC` are different markets on different dexes, with separate collateral
 * and separate positions. So matching compares the whole canonical symbol —
 * never the bare tail — and a bare symbol can never match a prefixed position.
 */

/** The market's name without its dex prefix: `xyz:GOLD-USDC` → `GOLD-USDC`. */
export function stripDexPrefix(coin: string): string {
  const separatorIndex = coin.indexOf(':');
  return separatorIndex === -1 ? coin : coin.slice(separatorIndex + 1);
}

/**
 * The exchange's own form of a symbol, so two spellings of one market compare
 * equal. Display form folds back to `dex:COIN`; everything else is returned as
 * it came.
 */
export function canonicalCoinSymbol(symbol: string): string {
  const separatorIndex = symbol.indexOf(':');
  if (separatorIndex === -1) return symbol;

  const left = symbol.slice(0, separatorIndex);
  const right = symbol.slice(separatorIndex + 1);

  // `COIN-USDC:dex` — the quote suffix sits on the left, the dex on the right.
  if (left.includes('-') && !right.includes('-')) return `${right}:${left}`;

  return symbol;
}

/** Do these two symbols name the same market, whatever form each is in? */
export function isSameMarketSymbol(a: string, b: string): boolean {
  return (
    canonicalCoinSymbol(a).toUpperCase() === canonicalCoinSymbol(b).toUpperCase()
  );
}

/**
 * The user's open position in one market, or null.
 *
 * Zero-size entries are skipped: the exchange keeps reporting a market for a
 * moment after the last contract is closed, and a position of nothing is not a
 * position.
 */
export function findPositionForSymbol(
  assetPositions: Array<{ position: Position }> | undefined | null,
  symbol: string,
): Position | null {
  if (!assetPositions || !symbol) return null;

  return (
    assetPositions.find(
      (assetPosition) =>
        assetPosition.position.szi !== 0 &&
        isSameMarketSymbol(assetPosition.position.coin, symbol),
    )?.position ?? null
  );
}
