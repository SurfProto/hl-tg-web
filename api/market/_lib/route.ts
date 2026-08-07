import { readThroughCache, RetryableCacheMissError } from "./cache";
import { getMarketPolicy, getNetwork } from "./config";
import { enforceRateLimit, getRequestIp } from "./rate-limit";
import {
  ensureGet,
  HttpError,
  jsonSuccess,
  withRoute,
  type ResponseMeta,
} from "./response";

export async function handleCachedPublicRoute<T>(
  request: any,
  response: any,
  args: {
    cacheKey: string;
    ttlSeconds: number;
    fetchFresh: () => Promise<T>;
  },
) {
  await withRoute(response, async () => {
    ensureGet(request);
    const policy = getMarketPolicy();
    if (policy.upstreamDisabled) {
      throw new HttpError(503, "UPSTREAM_DISABLED", "Market data is temporarily unavailable");
    }

    await enforceRateLimit({
      scope: "public",
      id: getRequestIp(request),
      limit: policy.rateLimit.publicPerMinute,
    });

    try {
      const result = await readThroughCache({
        key: `${getNetwork()}:${args.cacheKey}`,
        ttlSeconds: args.ttlSeconds,
        fetchFresh: args.fetchFresh,
      });
      jsonSuccess(response, result.data, result.meta);
    } catch (error) {
      if (error instanceof RetryableCacheMissError) {
        throw new HttpError(503, "CACHE_WARMING", error.message);
      }
      throw error;
    }
  });
}

export function privateMeta(ttlSeconds: number): ResponseMeta {
  return {
    cache: "miss",
    source: "upstream",
    fetchedAt: Date.now(),
    ttlSeconds,
  };
}
