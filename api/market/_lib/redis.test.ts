import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRedisMemoryForTests,
  redisGet,
  redisIncrWithTtl,
  redisSet,
  redisSetNx,
} from "./redis";

describe("redis env configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: "cached-value" }),
      }),
    );
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL = "https://kv.example.com";
    process.env.KV_REST_API_TOKEN = "kv-token";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    __resetRedisMemoryForTests();
  });

  it("uses Vercel KV marketplace env aliases for Redis REST calls", async () => {
    const result = await redisGet("market:test");

    expect(result).toEqual({ value: "cached-value", source: "redis" });
    expect(fetch).toHaveBeenCalledWith(
      "https://kv.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer kv-token",
        }),
      }),
    );
  });
});

/**
 * A stale UPSTASH_REDIS_REST_URL pointing at a deleted database (ENOTFOUND)
 * used to throw out of readThroughCache and 500 every market and account route.
 * A cache must not be able to take down the endpoint it accelerates.
 */
describe("redis degradation when the server is unreachable", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    const dnsFailure = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND dead.upstash.io"), {
        code: "ENOTFOUND",
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(dnsFailure));
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.UPSTASH_REDIS_REST_URL = "https://dead.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetRedisMemoryForTests();
  });

  it("reports a cache miss rather than throwing", async () => {
    await expect(redisGet("market:test")).resolves.toEqual({
      value: null,
      source: "redis",
    });
  });

  it("drops writes rather than throwing", async () => {
    await expect(redisSet("market:test", "value", 30)).resolves.toBeUndefined();
  });

  it("grants the refresh lock so callers do not fall into RetryableCacheMiss", async () => {
    await expect(redisSetNx("market:test:lock", "owner", 5)).resolves.toBe(true);
  });

  it("fails the rate limiter open instead of rejecting every request", async () => {
    await expect(redisIncrWithTtl("rl:test", 60)).resolves.toBe(0);
  });
});
