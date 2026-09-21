import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRedisMemoryForTests } from "../../market/_lib/redis";
import type { ProfileConfig } from "./config";
import {
  __resetProfileStaleTelemetryForTests,
  getProfileByPrivyUserId,
  invalidateProfileCache,
} from "./supabase-admin";

const config: ProfileConfig = {
  privyAppId: "privy_app_123",
  privyAppSecret: "privy_secret_123",
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "service_role_123",
};

const profile = {
  id: "user_123",
  telegram_id: "telegram_123",
  wallet_address: "0xwallet",
  privy_user_id: "did:privy:user_123",
  username: "alice",
  email: "alice@example.com",
  language: "en",
};

// The 2026-09-18 outage, in miniature: Supabase answers once, then returns
// Cloudflare's 522 page for the rest of the hour while the 60s fresh entry
// expires underneath every account read.
describe("getProfileByPrivyUserId when Supabase is unreachable", () => {
  const T0 = new Date("2026-09-18T11:00:00Z").getTime();
  const privyUserId = profile.privy_user_id;
  const ok = () => Response.json([profile]);
  const down = () => new Response("<!DOCTYPE html>522: Connection timed out", { status: 522 });
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
      vi.stubEnv(name, "");
    }
    __resetRedisMemoryForTests();
    __resetProfileStaleTelemetryForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A default that fails loudly: an exhausted once-queue must never fall
    // through to the real network and wait out a real 4s deadline.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch: once-queue exhausted"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("serves the fresh cache without touching Supabase", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok());
    await getProfileByPrivyUserId(config, privyUserId);
    await expect(getProfileByPrivyUserId(config, privyUserId)).resolves.toEqual(profile);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the last resolved profile when Supabase throws after the fresh entry expired", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok()).mockResolvedValueOnce(down());
    await getProfileByPrivyUserId(config, privyUserId);
    vi.setSystemTime(T0 + 61_000);
    await expect(getProfileByPrivyUserId(config, privyUserId)).resolves.toEqual(profile);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("profile-stale"),
      expect.objectContaining({ count: 1, kind: "http", status: 522 }),
    );
  });

  it("rethrows when Supabase throws and nothing stale exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(down());
    await expect(getProfileByPrivyUserId(config, privyUserId)).rejects.toThrow(/Supabase request failed: 522/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never replaces an authoritative 'no such profile' with a stale copy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok()).mockResolvedValueOnce(Response.json([]));
    await getProfileByPrivyUserId(config, privyUserId);
    vi.setSystemTime(T0 + 61_000);
    await expect(getProfileByPrivyUserId(config, privyUserId)).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("invalidateProfileCache removes the stale copy too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok()).mockResolvedValueOnce(down());
    await getProfileByPrivyUserId(config, privyUserId);
    await invalidateProfileCache(privyUserId);
    await expect(getProfileByPrivyUserId(config, privyUserId)).rejects.toThrow(/522/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops serving stale after twenty-four hours", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok()).mockResolvedValueOnce(down());
    await getProfileByPrivyUserId(config, privyUserId);
    vi.setSystemTime(T0 + 24 * 60 * 60 * 1000 + 1_000);
    await expect(getProfileByPrivyUserId(config, privyUserId)).rejects.toThrow(/522/);
  });

  it("still serves stale twenty-three hours in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok()).mockResolvedValueOnce(down());
    await getProfileByPrivyUserId(config, privyUserId);
    vi.setSystemTime(T0 + 23 * 60 * 60 * 1000);
    await expect(getProfileByPrivyUserId(config, privyUserId)).resolves.toEqual(profile);
  });

  it("an authoritative 'no such profile' purges the stale copy too", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(down());
    await getProfileByPrivyUserId(config, privyUserId);
    vi.setSystemTime(T0 + 61_000);
    await expect(getProfileByPrivyUserId(config, privyUserId)).resolves.toBeNull();
    vi.setSystemTime(T0 + 122_000);
    await expect(getProfileByPrivyUserId(config, privyUserId)).rejects.toThrow(/522/);
    expect(warn).not.toHaveBeenCalled();
  });
});
