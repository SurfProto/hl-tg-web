import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getProfileConfig: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
  requireTelegramInitData: vi.fn(),
  rateLimitAccount: vi.fn(),
  readThroughCache: vi.fn(),
  getAccountSnapshot: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("../profile/_lib/config", () => ({
  getProfileConfig: mocks.getProfileConfig,
}));

vi.mock("../profile/_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
}));

vi.mock("./_lib/telegram", () => ({
  requireTelegramInitData: mocks.requireTelegramInitData,
}));

vi.mock("./_lib/rate-limit", () => ({
  rateLimitAccount: mocks.rateLimitAccount,
}));

vi.mock("../market/_lib/cache", () => ({
  readThroughCache: mocks.readThroughCache,
  RetryableCacheMissError: class RetryableCacheMissError extends Error {},
}));

vi.mock("./_lib/upstream", () => ({
  getAccountSnapshot: mocks.getAccountSnapshot,
}));

import handler from "./snapshot";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    json: vi.fn(),
  };
}

describe("/api/account/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Vitest loads .env files into process.env, so a developer running against
    // testnet locally would otherwise flip the value this test asserts on and
    // see a failure that CI never reproduces. Pin it.
    vi.stubEnv("VITE_HYPERLIQUID_TESTNET", "false");
    mocks.getProfileConfig.mockReturnValue({ privyAppId: "privy-app-id" });
    mocks.requirePrivySession.mockResolvedValue({
      privyUserId: "did:privy:user:123",
    });
    mocks.getProfileByPrivyUserId.mockResolvedValue({
      id: "profile-1",
      wallet_address: "0xserver",
    });
    mocks.rateLimitAccount.mockResolvedValue(undefined);
    // requireAccountContext now checks the verified Telegram user against the
    // profile's linked telegram_id, so the stub has to return one.
    mocks.requireTelegramInitData.mockReturnValue({
      authDate: Math.floor(Date.now() / 1000),
      user: { id: 555, first_name: "Test" },
    });
    mocks.readThroughCache.mockImplementation(async ({ fetchFresh }) => ({
      data: await fetchFresh(),
      meta: {
        cache: "miss",
        source: "upstream",
        fetchedAt: 123,
        ttlSeconds: 2,
      },
    }));
    mocks.getAccountSnapshot.mockResolvedValue({
      userState: { marginSummary: { accountValue: 1 } },
      spotBalance: { balances: [] },
    });
  });

  it("uses the server-resolved wallet instead of any client wallet parameter", async () => {
    const response = createResponse();

    await handler(
      {
        method: "GET",
        headers: {
          authorization: "Bearer token",
          "x-telegram-init-data": "signed",
        },
        query: {
          wallet: "0xattacker",
        },
      },
      response,
    );

    expect(mocks.requirePrivySession).toHaveBeenCalled();
    expect(mocks.requireTelegramInitData).toHaveBeenCalledWith(expect.any(Object));
    expect(mocks.getProfileByPrivyUserId).toHaveBeenCalled();
    expect(mocks.getAccountSnapshot).toHaveBeenCalledWith({
      testnet: false,
      walletAddress: "0xserver",
    });
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        userState: { marginSummary: { accountValue: 1 } },
        spotBalance: { balances: [] },
      },
      meta: expect.objectContaining({ cache: "miss" }),
    });
  });
});
