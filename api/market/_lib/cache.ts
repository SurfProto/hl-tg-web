import {
  redisDelIfMatches,
  redisGet,
  redisSet,
  redisSetNx,
  __resetRedisMemoryForTests,
} from "./redis";
import type { ResponseMeta } from "./response";

interface CachedValue<T> {
  data: T;
  fetchedAt: number;
  ttlSeconds: number;
}

interface CacheReadOptions<T> {
  key: string;
  ttlSeconds: number;
  staleSeconds?: number;
  lockSeconds?: number;
  lockWaitMs?: number;
  fetchFresh: () => Promise<T>;
}

export class RetryableCacheMissError extends Error {
  constructor() {
    super("Temporarily unavailable; retry shortly");
    this.name = "RetryableCacheMissError";
  }
}

function parseCached<T>(value: string | null): CachedValue<T> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CachedValue<T>;
    if (typeof parsed.fetchedAt !== "number" || typeof parsed.ttlSeconds !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isFresh(entry: CachedValue<unknown>, at: number) {
  return at - entry.fetchedAt < entry.ttlSeconds * 1000;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readThroughCache<T>({
  key,
  ttlSeconds,
  staleSeconds = Math.max(ttlSeconds * 12, 30),
  lockSeconds = 5,
  lockWaitMs = 125,
  fetchFresh,
}: CacheReadOptions<T>): Promise<{ data: T; meta: ResponseMeta }> {
  const initial = await redisGet(key);
  const cached = parseCached<T>(initial.value);
  const currentTime = Date.now();

  if (cached && isFresh(cached, currentTime)) {
    return {
      data: cached.data,
      meta: {
        cache: "hit",
        source: initial.source,
        fetchedAt: cached.fetchedAt,
        ttlSeconds: cached.ttlSeconds,
      },
    };
  }

  const lockKey = `${key}:lock`;
  const lockValue = `${currentTime}:${Math.random().toString(36).slice(2)}`;
  const hasLock = await redisSetNx(lockKey, lockValue, lockSeconds);

  if (!hasLock) {
    if (cached) {
      return {
        data: cached.data,
        meta: {
          cache: "stale",
          source: initial.source,
          fetchedAt: cached.fetchedAt,
          ttlSeconds: cached.ttlSeconds,
        },
      };
    }

    // Wait for whoever holds the lock to publish, polling until the lock could
    // not still be held.
    //
    // This used to be a single 125ms sleep and one retry. That is far shorter
    // than a real refresh: the market:stats fanout — metaAndAssetCtxs plus
    // spotMetaAndAssetCtxs plus one call per HIP-3 dex — takes around two
    // seconds cold. And since /api/market/ticker now reads the same cached
    // aggregate as /api/market/stats, the two contend for one lock on every
    // page load, so the loser reliably gave up and returned 503 CACHE_WARMING.
    // The coin detail page showed it as Mark Price and Open Interest stuck on
    // "Loading...".
    //
    // Polling to the lock's own expiry turns contention into a slightly slow
    // success instead of an error. If nothing is published by then the holder
    // has died or genuinely failed, and 503 is the honest answer.
    const deadline = Date.now() + lockSeconds * 1000;
    while (Date.now() < deadline) {
      await sleep(lockWaitMs);
      const retry = await redisGet(key);
      const retryCached = parseCached<T>(retry.value);
      if (retryCached) {
        return {
          data: retryCached.data,
          meta: {
            cache: isFresh(retryCached, Date.now()) ? "hit" : "stale",
            source: retry.source,
            fetchedAt: retryCached.fetchedAt,
            ttlSeconds: retryCached.ttlSeconds,
          },
        };
      }
    }

    throw new RetryableCacheMissError();
  }

  try {
    const data = await fetchFresh();
    const fetchedAt = Date.now();
    await redisSet(
      key,
      JSON.stringify({
        data,
        fetchedAt,
        ttlSeconds,
      } satisfies CachedValue<T>),
      ttlSeconds + staleSeconds,
    );

    return {
      data,
      meta: {
        cache: cached ? "stale" : "miss",
        source: "upstream",
        fetchedAt,
        ttlSeconds,
      },
    };
  } catch (error) {
    if (cached) {
      return {
        data: cached.data,
        meta: {
          cache: "stale",
          source: initial.source,
          fetchedAt: cached.fetchedAt,
          ttlSeconds: cached.ttlSeconds,
        },
      };
    }

    throw error;
  } finally {
    // Release only our own lock. If fetchFresh outran lockSeconds the lock has
    // already expired and may belong to another request by now; deleting it
    // would let a third request in and defeat the point of holding it.
    await redisDelIfMatches(lockKey, lockValue);
  }
}

export function __resetMarketCacheForTests() {
  __resetRedisMemoryForTests();
}
