import { readThroughCache, RetryableCacheMissError } from "../../market/_lib/cache";
import { getNetwork } from "../../market/_lib/config";
import {
  ensureGet,
  HttpError,
  jsonSuccess,
  withRoute,
} from "../../market/_lib/response";
import { requireAccountContext } from "./auth";

export async function handleCachedAccountRoute<T>(
  request: any,
  response: any,
  args: {
    cacheKey: (walletAddress: string) => string;
    ttlSeconds: number;
    fetchFresh: (walletAddress: string) => Promise<T>;
  },
) {
  await withRoute(response, async () => {
    ensureGet(request);
    const account = await requireAccountContext(request);
    const network = getNetwork();

    try {
      const result = await readThroughCache({
        key: `${network}:${args.cacheKey(account.walletAddress.toLowerCase())}`,
        ttlSeconds: args.ttlSeconds,
        fetchFresh: () => args.fetchFresh(account.walletAddress),
      });
      jsonSuccess(response, result.data, result.meta, { private: true });
    } catch (error) {
      if (error instanceof RetryableCacheMissError) {
        throw new HttpError(503, "CACHE_WARMING", error.message);
      }
      throw error;
    }
  });
}

export function isTestnet() {
  return getNetwork() === "testnet";
}
