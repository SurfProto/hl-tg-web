import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamTimeoutError } from "../../_lib/fetch-with-timeout";
import { SupabaseRequestError } from "../../_lib/supabase";
import { __resetSupabaseUnavailableTelemetryForTests } from "../../_lib/supabase-telemetry";

const mocks = vi.hoisted(() => ({
  getProfileConfig: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
  requirePrivySession: vi.fn(),
  requireTelegramInitData: vi.fn(),
  enforceRateLimit: vi.fn(),
  getAccountSnapshot: vi.fn(),
}));

vi.mock("../../profile/_lib/config", () => ({ getProfileConfig: mocks.getProfileConfig }));
vi.mock("../../profile/_lib/supabase-admin", () => ({ getProfileByPrivyUserId: mocks.getProfileByPrivyUserId }));
vi.mock("../../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./telegram", () => ({ requireTelegramInitData: mocks.requireTelegramInitData }));
vi.mock("../../market/_lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../market/_lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("./upstream", () => ({ getAccountSnapshot: mocks.getAccountSnapshot }));

import handler from "../snapshot";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), setHeader: vi.fn(), json: vi.fn() };
}
const request = () => ({
  method: "GET",
  headers: { authorization: "Bearer good", "x-telegram-init-data": "x" },
  query: {},
});

// The 2026-09-18 misread: a database outage surfaced as 500 INTERNAL_ERROR, the
// shape every code defect produces, and was chased as an auth bug for hours.
describe("/api/account/snapshot when the profile lookup cannot reach Supabase", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSupabaseUnavailableTelemetryForTests();
    vi.stubEnv("NODE_ENV", "production");
    mocks.getProfileConfig.mockReturnValue({ privyAppId: "privy-app-id" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:123" });
    mocks.requireTelegramInitData.mockReturnValue({ user: { id: 123 } });
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    ["http 522", new SupabaseRequestError("Supabase request failed: 522 <!DOCTYPE html>", "http", 522)],
    ["a connection that never opened", new SupabaseRequestError("Supabase request failed: fetch failed", "network", null)],
    ["the 4s deadline", new UpstreamTimeoutError("https://supabase.example/rest/v1/users", 4000)],
  ])("answers 503 PROFILE_LOOKUP_UNAVAILABLE for %s and writes the [supabase] unavailable line", async (_label, error) => {
    mocks.getProfileByPrivyUserId.mockRejectedValue(error);
    const response = createResponse();
    await handler(request(), response);
    expect(response.status).toHaveBeenCalledWith(503);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: false, code: "PROFILE_LOOKUP_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("html");
    expect(mocks.getAccountSnapshot).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[supabase] unavailable (account-auth)"),
      expect.objectContaining({ count: 1 }),
    );
  });

  it.each([
    ["a 401 - Supabase answered", new SupabaseRequestError("Supabase request failed: 401 {}", "http", 401)],
    ["a 200 HTML page - a misrouted URL", new SupabaseRequestError("Supabase returned HTML for users", "html", 200)],
  ])("still answers 500 for %s, so a misconfiguration is not dressed up as an outage", async (_label, error) => {
    mocks.getProfileByPrivyUserId.mockRejectedValue(error);
    const response = createResponse();
    await handler(request(), response);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json.mock.calls[0][0].code).toBe("INTERNAL_ERROR");
    expect(warn).not.toHaveBeenCalled();
  });
});
