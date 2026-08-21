/**
 * Canonicalise a market symbol from a query string.
 *
 * The three symbol routes used to call `.toUpperCase()` on the whole value.
 * That is right for a plain perp or a spot pair, and wrong for HIP-3: those
 * markets are keyed with a **lowercase dex prefix** — `xyz:GOLD`, `mkts:US500`,
 * `io:ANTH` — so uppercasing turned `xyz:GOLD` into `XYZ:GOLD`, which matches
 * nothing in the stats or mids maps. /api/market/ticker answered null for every
 * HIP-3 market, and the coin detail page renders open interest as
 * `openInterest * price`, so one missing price blanked both fields.
 *
 * Depth and candles survived it only because they resolve through
 * resolveMarket, which compares case-insensitively.
 */
export function normalizeMarketSymbol(raw: string): string {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) {
    return raw.toUpperCase();
  }

  const dex = raw.slice(0, separatorIndex).toLowerCase();
  const coin = raw.slice(separatorIndex + 1).toUpperCase();
  return `${dex}:${coin}`;
}
