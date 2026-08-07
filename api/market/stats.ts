import { getMarketPolicy, getNetwork } from "./_lib/config";
import { handleCachedPublicRoute } from "./_lib/route";
import { fetchStats } from "./_lib/upstream";

export default async function handler(request: any, response: any) {
  const policy = getMarketPolicy();
  await handleCachedPublicRoute(request, response, {
    cacheKey: "market:stats",
    ttlSeconds: policy.ttlSeconds.stats,
    fetchFresh: () => fetchStats(getNetwork()),
  });
}
