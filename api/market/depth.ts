import { getNetwork, getTtlForSymbol } from "./_lib/config";
import { getQueryValue, getRequiredQueryValue, jsonError } from "./_lib/response";
import { handleCachedPublicRoute } from "./_lib/route";
import { fetchDepth } from "./_lib/upstream";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? "20");
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

export default async function handler(request: any, response: any) {
  try {
    const symbol = getRequiredQueryValue(request, "symbol").toUpperCase();
    const limit = parseLimit(getQueryValue(request, "limit"));
    await handleCachedPublicRoute(request, response, {
      cacheKey: `market:depth:${symbol}:${limit}`,
      ttlSeconds: getTtlForSymbol({ route: "depth", symbol }),
      fetchFresh: () => fetchDepth(getNetwork(), symbol, limit),
    });
  } catch (error) {
    jsonError(response, error);
  }
}
