import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetMarketCacheForTests,
  readThroughCache,
  RetryableCacheMissError,
} from "./cache";

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

  it("returns a retryable miss when an empty key is locked", async () => {
    const first = readThroughCache({
      key: "market:test:locked",
      ttlSeconds: 10,
      lockSeconds: 1,
      fetchFresh: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { price: 100 };
      },
    });

    await expect(
      readThroughCache({
        key: "market:test:locked",
        ttlSeconds: 10,
        lockSeconds: 1,
        lockWaitMs: 1,
        fetchFresh: async () => ({ price: 101 }),
      }),
    ).rejects.toBeInstanceOf(RetryableCacheMissError);

    await first;
  });
});
