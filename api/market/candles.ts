import { getMarketPolicy, getNetwork } from "./_lib/config";
import { getQueryValue, getRequiredQueryValue, jsonError } from "./_lib/response";
import { handleCachedPublicRoute } from "./_lib/route";
import { fetchCandles } from "./_lib/upstream";

const ALLOWED_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"]);

function normalizeInterval(value: string | null) {
  const interval = value?.trim() || "1h";
  return ALLOWED_INTERVALS.has(interval) ? interval : "1h";
}

export default async function handler(request: any, response: any) {
  try {
    const policy = getMarketPolicy();
    const symbol = getRequiredQueryValue(request, "symbol").toUpperCase();
    const interval = normalizeInterval(getQueryValue(request, "interval"));
    await handleCachedPublicRoute(request, response, {
      cacheKey: `market:candles:${symbol}:${interval}`,
      ttlSeconds: policy.ttlSeconds.candles,
      fetchFresh: () => fetchCandles(getNetwork(), symbol, interval),
    });
  } catch (error) {
    jsonError(response, error);
  }
}
