import { getNetwork, getTtlForSymbol } from "./_lib/config";
import { getRequiredQueryValue, jsonError } from "./_lib/response";
import { handleCachedPublicRoute } from "./_lib/route";
import { fetchTicker } from "./_lib/upstream";
import { normalizeMarketSymbol } from "./_lib/symbol";

export default async function handler(request: any, response: any) {
  try {
    const symbol = normalizeMarketSymbol(getRequiredQueryValue(request, "symbol"));
    await handleCachedPublicRoute(request, response, {
      cacheKey: `market:ticker:${symbol}`,
      ttlSeconds: getTtlForSymbol({ route: "ticker", symbol }),
      fetchFresh: () => fetchTicker(getNetwork(), symbol),
    });
  } catch (error) {
    jsonError(response, error);
  }
}
