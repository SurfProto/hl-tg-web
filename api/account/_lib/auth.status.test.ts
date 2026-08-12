import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the two HttpError classes bug.
 *
 * market/_lib/response.ts and onramp/_lib/http.ts each used to declare their
 * own HttpError. Account routes catch with the market one, but the auth layer
 * throws the onramp one, so `instanceof` missed and every 401 surfaced as a 500
 * INTERNAL_ERROR with the internal message in the body. The client could not
 * tell "log in again" from "the server is broken", so sessions never recovered.
 *
 * snapshot.test.ts mocks the whole auth layer and therefore cannot catch this.
 * These tests deliberately leave the real requireAccountContext in place and
 * only stub what it calls out to.
 */

const mocks = vi.hoisted(() => ({
  getProfileConfig: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
  requirePrivySession: vi.fn(),
  enforceRateLimit: vi.fn(),
  getAccountSnapshot: vi.fn(),
}));

vi.mock("../../profile/_lib/config", () => ({
  getProfileConfig: mocks.getProfileConfig,
}));

vi.mock("../../profile/_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
}));

vi.mock("../../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("../../market/_lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../market/_lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));

vi.mock("./upstream", () => ({
  getAccountSnapshot: mocks.getAccountSnapshot,
}));

import { HttpError as MarketHttpError } from "../../market/_lib/response";
import { HttpError as OnrampHttpError } from "../../onramp/_lib/http";
import handler from "../snapshot";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    json: vi.fn(),
  };
}

function request(headers: Record<string, string> = {}) {
  return { method: "GET", headers, query: {} };
}

describe("HttpError identity", () => {
  it("is one class across the market and onramp modules", () => {
    expect(MarketHttpError).toBe(OnrampHttpError);
    expect(new OnrampHttpError(401, "UNAUTHORIZED", "x")).toBeInstanceOf(MarketHttpError);
  });
});

describe("/api/account/snapshot auth failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MARKET_TELEGRAM_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("NODE_ENV", "production");
    mocks.getProfileConfig.mockReturnValue({ privyAppId: "privy-app-id" });
    mocks.enforceRateLimit.mockResolvedValue(undefined);
    mocks.getProfileByPrivyUserId.mockResolvedValue({
      id: "profile-1",
      wallet_address: "0xserver",
    });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:123" });
  });

  // The dev bypass in ./dev-bypass.ts returns a context without any credentials.
  // These tests all run with DEV_ACCOUNT_WALLET unset; this one asserts that
  // setting it changes nothing while NODE_ENV is production, so the bypass
  // cannot weaken the deployed auth path.
  it("ignores the dev account bypass when NODE_ENV is production", async () => {
    vi.stubEnv("DEV_ACCOUNT_WALLET", "0x1111111111111111111111111111111111111111");
    mocks.requirePrivySession.mockRejectedValue(
      new OnrampHttpError(401, "UNAUTHORIZED", "Missing or invalid access token"),
    );
    const response = createResponse();

    await handler(request({ authorization: "Bearer bad", "x-telegram-init-data": "x" }), response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.getAccountSnapshot).not.toHaveBeenCalled();
  });

  it("returns 401, not 500, when the access token is rejected", async () => {
    mocks.requirePrivySession.mockRejectedValue(
      new OnrampHttpError(401, "UNAUTHORIZED", "Missing or invalid access token"),
    );
    const response = createResponse();

    await handler(request({ authorization: "Bearer bad", "x-telegram-init-data": "x" }), response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: "UNAUTHORIZED" }),
    );
  });

  it("returns 401, not 500, when Telegram init data is missing", async () => {
    const response = createResponse();

    await handler(request({ authorization: "Bearer good" }), response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: "UNAUTHORIZED" }),
    );
  });

  it("does not leak internal error text for unexpected failures", async () => {
    mocks.requirePrivySession.mockRejectedValue(
      new Error('Supabase request failed: 409 duplicate key value violates unique constraint "users_pkey"'),
    );
    const response = createResponse();

    await handler(request({ authorization: "Bearer good", "x-telegram-init-data": "x" }), response);

    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.json.mock.calls[0][0];
    expect(body.error).toBe("Unexpected server error");
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("users_pkey");
  });
});
