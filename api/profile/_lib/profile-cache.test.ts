import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRedisMemoryForTests } from "../../market/_lib/redis";
import {
  getProfileByPrivyUserId,
  invalidateProfileCache,
} from "./supabase-admin";

/**
 * requireAccountContext resolves the profile on every /api/account/* request,
 * and it runs before the Redis payload cache — so even a cache hit cost one
 * Supabase query. At the client's polling rates that was roughly 32 queries per
 * minute per active user, purely to map a Privy user id to a wallet address.
 *
 * These tests pin the three properties that make caching it safe: hits are
 * reused, misses are not cached, and writes invalidate.
 */

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "service-role-key",
  privyAppId: "app",
} as never;

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
  };
}

const PROFILE = {
  id: "profile-1",
  telegram_id: "12345",
  wallet_address: "0xabc",
  privy_user_id: "did:privy:user-1",
  username: "trader",
  email: null,
  language: "en",
};

describe("profile lookup caching", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetRedisMemoryForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRedisMemoryForTests();
  });

  it("queries Supabase once and serves the second call from cache", async () => {
    fetchMock.mockResolvedValue(jsonResponse([PROFILE]));

    const first = await getProfileByPrivyUserId(config, "did:privy:user-1");
    const second = await getProfileByPrivyUserId(config, "did:privy:user-1");

    expect(first).toEqual(PROFILE);
    expect(second).toEqual(PROFILE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a miss, so a new signup is visible immediately", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    expect(await getProfileByPrivyUserId(config, "did:privy:new")).toBeNull();

    // The row now exists; the next call must go to Supabase rather than
    // replaying the cached "no such profile".
    fetchMock.mockResolvedValueOnce(jsonResponse([PROFILE]));
    expect(await getProfileByPrivyUserId(config, "did:privy:new")).toEqual(PROFILE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-reads after invalidation", async () => {
    fetchMock.mockResolvedValue(jsonResponse([PROFILE]));
    await getProfileByPrivyUserId(config, "did:privy:user-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await invalidateProfileCache("did:privy:user-1");

    const relinked = { ...PROFILE, wallet_address: "0xdef" };
    fetchMock.mockResolvedValue(jsonResponse([relinked]));
    expect(await getProfileByPrivyUserId(config, "did:privy:user-1")).toEqual(relinked);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps different users separate", async () => {
    const other = { ...PROFILE, id: "profile-2", privy_user_id: "did:privy:user-2", wallet_address: "0x222" };
    fetchMock.mockResolvedValueOnce(jsonResponse([PROFILE]));
    fetchMock.mockResolvedValueOnce(jsonResponse([other]));

    const a = await getProfileByPrivyUserId(config, "did:privy:user-1");
    const b = await getProfileByPrivyUserId(config, "did:privy:user-2");

    expect(a?.wallet_address).toBe("0xabc");
    expect(b?.wallet_address).toBe("0x222");
    // And each is now cached under its own key.
    expect(await getProfileByPrivyUserId(config, "did:privy:user-1")).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Supabase when the cached entry is unparseable", async () => {
    const { redisSet } = await import("../../market/_lib/redis");
    await redisSet("profile:privy:did:privy:user-1", "not json", 60);
    fetchMock.mockResolvedValue(jsonResponse([PROFILE]));

    expect(await getProfileByPrivyUserId(config, "did:privy:user-1")).toEqual(PROFILE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
