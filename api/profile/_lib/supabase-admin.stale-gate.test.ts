import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { UpstreamTimeoutError } from "../../_lib/fetch-with-timeout";
import { __resetRedisMemoryForTests } from "../../market/_lib/redis";
import type { ProfileConfig } from "./config";
import { __resetProfileStaleTelemetryForTests, getProfileByPrivyUserId } from "./supabase-admin";

const config: ProfileConfig = { privyAppId: "a", privyAppSecret: "s", supabaseUrl: "https://supabase.example", supabaseServiceRoleKey: "k" };
const ID = "did:privy:user_123";
const row = (wallet: string) => ({ id: "user_123", telegram_id: "t", wallet_address: wallet, privy_user_id: ID, username: "alice", email: "a@e.com", language: "en" });
const ok = (wallet = "0xwallet") => Response.json([row(wallet)]);
const http = (status: number, body = "<!DOCTYPE html>") => new Response(body, { status });
const typed = (body: string, contentType: string) => new Response(body, { status: 200, headers: { "content-type": contentType } });

// What the stale copy may answer for, and what it may not.
describe("getProfileByPrivyUserId stale gate", () => {
  const T0 = new Date("2026-09-18T11:00:00Z").getTime();
  let warn: ReturnType<typeof vi.spyOn>;
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const n of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) vi.stubEnv(n, "");
    __resetRedisMemoryForTests();
    __resetProfileStaleTelemetryForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Fail loudly if a once-queue is exhausted; never fall through to the network.
    fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch: once-queue exhausted"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  async function warmThenExpire() {
    fetchMock.mockResolvedValueOnce(ok());
    await getProfileByPrivyUserId(config, ID);
    vi.setSystemTime(T0 + 61_000);
  }

  it.each([
    ["a 4xx - Supabase answered, it did not fail", () => http(401, "{}"), /failed: 401/],
    ["a 200 HTML page - a misrouted URL, not an outage", () => typed("<!DOCTYPE html>", "text/html"), /returned HTML/],
    ["invalid JSON - a body from the wrong service", () => typed("{oops", "application/json"), /invalid JSON/],
  ])("rethrows %s even with a stale copy", async (_label, response, pattern) => {
    await warmThenExpire();
    fetchMock.mockResolvedValueOnce(response());
    await expect(getProfileByPrivyUserId(config, ID)).rejects.toThrow(pattern);
    expect(warn).not.toHaveBeenCalled();
  });

  it("serves stale when the 4s deadline fires", async () => {
    await warmThenExpire();
    fetchMock.mockRejectedValueOnce(new UpstreamTimeoutError("u", 4000));
    await expect(getProfileByPrivyUserId(config, ID)).resolves.toEqual(row("0xwallet"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("profile-stale"), expect.objectContaining({ count: 1, kind: "timeout" }));
  });

  it("serves stale when the connection never opened", async () => {
    await warmThenExpire();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(getProfileByPrivyUserId(config, ID)).resolves.toEqual(row("0xwallet"));
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "network" }));
  });

  it("the stale copy is the latest row Supabase answered with", async () => {
    fetchMock.mockResolvedValueOnce(ok("0xold")).mockResolvedValueOnce(ok("0xnew")).mockResolvedValueOnce(http(522));
    await getProfileByPrivyUserId(config, ID);
    vi.setSystemTime(T0 + 61_000);
    await getProfileByPrivyUserId(config, ID);
    vi.setSystemTime(T0 + 122_000);
    await expect(getProfileByPrivyUserId(config, ID)).resolves.toEqual(row("0xnew"));
  });

  it("re-primes the fresh key after a stale serve so the next poll skips the dead DB", async () => {
    await warmThenExpire();
    fetchMock.mockResolvedValueOnce(http(522));
    await getProfileByPrivyUserId(config, ID);
    await expect(getProfileByPrivyUserId(config, ID)).resolves.toEqual(row("0xwallet"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(T0 + 61_000 + 16_000);
    fetchMock.mockResolvedValueOnce(http(522));
    await getProfileByPrivyUserId(config, ID);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throttles the stale-serve log after the first three", async () => {
    await warmThenExpire();
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(http(522));
      await getProfileByPrivyUserId(config, ID);
      vi.setSystemTime(T0 + 61_000 + (i + 1) * 16_000);
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
