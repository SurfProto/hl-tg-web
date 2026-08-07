import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRedisMemoryForTests, redisGet } from "./redis";

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
