import { getMarketBaseAsset } from "@repo/hyperliquid-sdk";

/**
 * The symbol an icon should represent, given whatever a caller happens to hold.
 *
 * Callers pass wildly different shapes — `fill.coin` is `dex:GOLD-USDC` for a
 * HIP-3 position, `displayName.split("/")[0]` is already trimmed, and a plain
 * perp is just `BTC`. TokenIcon used to key its lookup off that raw string and
 * derive initials from it, which meant HIP-3 markets stripped to
 * `VNTLSGOLDUSDC` and every market on a dex rendered the same two letters —
 * "VN" — while a dex-listed BTC missed the BTC icon the app already ships.
 */
const QUOTE_SUFFIX = /-(USDC|USDH|USDT|USDE)$/iu;

export function getIconSymbol(coin: string): string {
  if (!coin) return "";

  // getMarketBaseAsset understands both HIP-3 spellings — `dex:COIN-USDC` and
  // the display form `COIN-USDC:dex` — but keeps the quote suffix, which an
  // icon does not want.
  return getMarketBaseAsset(coin).replace(QUOTE_SUFFIX, "");
}

/** Two characters for the generated fallback, from the symbol rather than the raw string. */
export function getIconInitials(coin: string): string {
  return getIconSymbol(coin)
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}
