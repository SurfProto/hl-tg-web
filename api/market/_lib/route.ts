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
    /**
     * Narrow what is sent without narrowing what is cached. A filtered view
     * shares the one cache entry, so asking for a single symbol never costs
     * an extra rebuild of the whole fan-out.
     */
    select?: (data: T) => unknown;
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
      const payload = args.select ? args.select(result.data) : result.data;
      jsonSuccess(response, payload, result.meta);
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
