import { getMarketPolicy, getNetwork } from "./_lib/config";
import { getQueryValue } from "./_lib/response";
import { handleCachedPublicRoute } from "./_lib/route";
import { normalizeMarketSymbol } from "./_lib/symbol";
import { fetchStats } from "./_lib/upstream";

/**
 * Every market's stats, or one market's.
 *
 * The coin detail page needs a single row and used to download all 1037 to
 * find it — 29KB brotli, and 1037 objects to parse on a phone, to render one.
 * `?symbol=` returns just that entry, or null when the market is unknown.
 *
 * The filter is applied after the cache read, deliberately: one cached blob
 * still backs every caller, so a per-symbol request cannot trigger its own
 * rebuild of the eight-call fan-out.
 */
export default async function handler(request: any, response: any) {
  const policy = getMarketPolicy();
  const requestedSymbol = getQueryValue(request, "symbol")?.trim();
  const symbol = requestedSymbol ? normalizeMarketSymbol(requestedSymbol) : null;

  await handleCachedPublicRoute(request, response, {
    cacheKey: "market:stats",
    ttlSeconds: policy.ttlSeconds.stats,
    fetchFresh: () => fetchStats(getNetwork()),
    select: symbol ? (stats) => stats[symbol] ?? null : undefined,
  });
}
