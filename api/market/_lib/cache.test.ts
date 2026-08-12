import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetMarketCacheForTests,
  readThroughCache,
  RetryableCacheMissError,
} from "./cache";
import { redisGet, redisSetNx } from "./redis";

describe("readThroughCache", () => {
  beforeEach(() => {
    __resetMarketCacheForTests();
    vi.useRealTimers();
  });

  it("serves a fresh cache hit without calling upstream", async () => {
    const upstream = vi.fn().mockResolvedValue({ price: 100 });

    await readThroughCache({
      key: "market:test:fresh",
      ttlSeconds: 10,
      fetchFresh: upstream,
    });
    const second = await readThroughCache({
      key: "market:test:fresh",
      ttlSeconds: 10,
      fetchFresh: upstream,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(second.meta.cache).toBe("hit");
    expect(second.data).toEqual({ price: 100 });
  });

  it("returns stale data when refresh fails", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce({ price: 100 })
      .mockRejectedValueOnce(new Error("upstream down"));

    await readThroughCache({
      key: "market:test:stale",
      ttlSeconds: 0,
      fetchFresh: upstream,
    });
    const second = await readThroughCache({
      key: "market:test:stale",
      ttlSeconds: 0,
      fetchFresh: upstream,
    });

    expect(second.meta.cache).toBe("stale");
    expect(second.data).toEqual({ price: 100 });
  });

  it("does not release a lock it no longer owns", async () => {
    const key = "market:test:lock-handover";
    const lockKey = `${key}:lock`;

    // A refresh that outlives its own lock: the lock expires mid-flight and a
    // second request takes it. When the slow refresh finishes it must not
    // delete the lock that now belongs to someone else.
    const slow = readThroughCache({
      key,
      ttlSeconds: 10,
      lockSeconds: 1,
      fetchFresh: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_400));
        return { price: 100 };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await redisSetNx(lockKey, "second-owner", 5)).toBe(true);

    await slow;

    expect((await redisGet(lockKey)).value).toBe("second-owner");
  });

  it("waits for the lock holder's result instead of returning a retryable miss", async () => {
    const key = "market:test:slow-holder";

    // A refresh far slower than the old flat 125ms wait. /api/market/stats and
    // /api/market/ticker share this key, so on every page load one of them is
    // the waiter — and it used to give up and 503.
    const slow = readThroughCache({
      key,
      ttlSeconds: 10,
      lockSeconds: 5,
      fetchFresh: async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return { price: 100 };
      },
    });

    // Let the first caller take the lock before the second arrives.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const waiter = await readThroughCache({
      key,
      ttlSeconds: 10,
      lockSeconds: 5,
      lockWaitMs: 50,
      fetchFresh: async () => {
        throw new Error("the waiter must not fetch; it should read the holder's result");
      },
    });

    expect(waiter.data).toEqual({ price: 100 });
    expect(waiter.meta.cache).toBe("hit");
    await slow;
  });

  it("returns a retryable miss only when the holder never publishes", async () => {
    const key = "market:test:abandoned";

    // Hold the lock with nothing behind it: the holder has died, or its fetch
    // is failing. Previously any contention produced this outcome after 125ms;
    // now it takes an abandoned lock, which is the only case where 503 is the
    // honest answer.
    expect(await redisSetNx(`${key}:lock`, "someone-else", 5)).toBe(true);

    await expect(
      readThroughCache({
        key,
        ttlSeconds: 10,
        // Poll for 200ms, not the 5s default, so the test stays quick.
        lockSeconds: 0.2,
        lockWaitMs: 20,
        fetchFresh: async () => ({ price: 101 }),
      }),
    ).rejects.toBeInstanceOf(RetryableCacheMissError);
  });
});
