import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireAccountContext called requireTelegramInitData and threw the result
 * away, so a verified signature from *any* user of the bot satisfied the check.
 * The Telegram account presenting the request must be the one linked to the
 * Privy profile the access token belongs to.
 */

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  requireTelegramInitData: vi.fn(),
  rateLimitAccount: vi.fn(),
  getProfileConfig: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
}));

vi.mock("../../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("./telegram", () => ({
  requireTelegramInitData: mocks.requireTelegramInitData,
}));

vi.mock("./rate-limit", () => ({
  rateLimitAccount: mocks.rateLimitAccount,
}));

vi.mock("../../profile/_lib/config", () => ({
  getProfileConfig: mocks.getProfileConfig,
}));

vi.mock("../../profile/_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
}));

import { requireAccountContext } from "./auth";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    telegram_id: "555",
    wallet_address: "0xserver",
    ...overrides,
  };
}

describe("requireAccountContext Telegram binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileConfig.mockReturnValue({ privyAppId: "app-id" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:1" });
    mocks.rateLimitAccount.mockResolvedValue(undefined);
    mocks.getProfileByPrivyUserId.mockResolvedValue(profile());
    mocks.requireTelegramInitData.mockReturnValue({
      authDate: 1,
      user: { id: 555, first_name: "Ada" },
    });
  });

  it("accepts the Telegram account linked to the profile", async () => {
    await expect(requireAccountContext({ headers: {} })).resolves.toMatchObject({
      privyUserId: "did:privy:1",
      telegramUserId: "555",
      walletAddress: "0xserver",
    });
  });

  it("rejects valid init data from a different Telegram account", async () => {
    mocks.requireTelegramInitData.mockReturnValue({
      authDate: 1,
      user: { id: 999, first_name: "Mallory" },
    });

    await expect(requireAccountContext({ headers: {} })).rejects.toMatchObject({
      statusCode: 403,
      code: "TELEGRAM_IDENTITY_MISMATCH",
    });
  });

  it("allows a profile with no linked Telegram id through", async () => {
    // Nothing to compare against yet — bootstrap links it later.
    mocks.getProfileByPrivyUserId.mockResolvedValue(profile({ telegram_id: null }));

    await expect(requireAccountContext({ headers: {} })).resolves.toMatchObject({
      telegramUserId: "555",
    });
  });

  it("still requires a wallet on the profile", async () => {
    mocks.getProfileByPrivyUserId.mockResolvedValue(profile({ wallet_address: "  " }));

    await expect(requireAccountContext({ headers: {} })).rejects.toMatchObject({
      statusCode: 404,
      code: "PROFILE_WALLET_NOT_FOUND",
    });
  });
});
