import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  requireTelegramInitData: vi.fn(),
  getProfileConfig: vi.fn(),
  resolveAuthoritativeProfileIdentity: vi.fn(),
  bootstrapProfileUser: vi.fn(),
  getNotificationPreferences: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("../account/_lib/telegram", () => ({
  requireTelegramInitData: mocks.requireTelegramInitData,
}));

vi.mock("./_lib/config", () => ({
  getProfileConfig: mocks.getProfileConfig,
}));

vi.mock("./_lib/identity", () => ({
  resolveAuthoritativeProfileIdentity: mocks.resolveAuthoritativeProfileIdentity,
}));

vi.mock("./_lib/supabase-admin", () => ({
  bootstrapProfileUser: mocks.bootstrapProfileUser,
  getNotificationPreferences: mocks.getNotificationPreferences,
}));

import handler from "./bootstrap";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("POST /api/profile/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileConfig.mockReturnValue({
      privyAppId: "privy-app-id",
    });
    mocks.requirePrivySession.mockResolvedValue({
      privyUserId: "did:privy:user:123",
    });
    mocks.requireTelegramInitData.mockReturnValue({
      user: {
        id: 123,
        username: "alice_signed",
      },
    });
    mocks.resolveAuthoritativeProfileIdentity.mockResolvedValue({
      walletAddress: "0xabc",
      email: "alice@example.com",
    });
    mocks.bootstrapProfileUser.mockResolvedValue({
      id: "user-1",
      telegram_id: "123",
      wallet_address: "0xabc",
      privy_user_id: "did:privy:user:123",
      username: "alice",
      email: "alice@example.com",
      language: "en",
    });
    mocks.getNotificationPreferences.mockResolvedValue({
      liquidation_alerts: true,
      order_fills: true,
      usdc_deposits: true,
    });
  });

  it("derives Telegram identity from signed init data and ignores client identity fields", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "x-telegram-init-data": "signed-telegram-data",
        },
        body: {
          telegramId: "attacker-id",
          walletAddress: "0xattacker",
          username: "attacker",
          email: "attacker@example.com",
          language: "ru",
        },
      },
      response,
    );

    expect(mocks.requirePrivySession).toHaveBeenCalledWith(
      expect.any(Object),
      "privy-app-id",
    );
    expect(mocks.requireTelegramInitData).toHaveBeenCalledWith(expect.any(Object));
    expect(mocks.bootstrapProfileUser).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        privyUserId: "did:privy:user:123",
        telegramId: "123",
        walletAddress: "0xabc",
        email: "alice@example.com",
        username: "alice_signed",
        language: "ru",
      }),
    );
    expect(mocks.bootstrapProfileUser).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        walletAddress: "0xattacker",
        email: "attacker@example.com",
      }),
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        profile: expect.objectContaining({
          id: "user-1",
          walletAddress: "0xabc",
          email: "alice@example.com",
        }),
        notificationPreferences: {
          liquidationAlerts: true,
          orderFills: true,
          usdcDeposits: true,
        },
      },
    });
  });

  it("does not require or modify Telegram identity for wallet-only bootstrap", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { language: "en" },
      },
      response,
    );

    expect(mocks.requireTelegramInitData).not.toHaveBeenCalled();
    expect(mocks.bootstrapProfileUser).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        privyUserId: "did:privy:user:123",
        telegramId: null,
        username: null,
      }),
    );
  });
});
