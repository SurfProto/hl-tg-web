import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getProfileConfig: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
  getNotificationPreferences: vi.fn(),
  getNotificationChannelStatus: vi.fn(),
  updateProfileUser: vi.fn(),
}));

vi.mock("./onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("./profile/_lib/config", () => ({
  getProfileConfig: mocks.getProfileConfig,
}));

vi.mock("./profile/_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
  getNotificationPreferences: mocks.getNotificationPreferences,
  getNotificationChannelStatus: mocks.getNotificationChannelStatus,
  updateProfileUser: mocks.updateProfileUser,
}));

import handler from "./profile";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("/api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileConfig.mockReturnValue({
      privyAppId: "privy-app-id",
    });
    mocks.requirePrivySession.mockResolvedValue({
      privyUserId: "did:privy:user:123",
    });
    mocks.getProfileByPrivyUserId.mockResolvedValue({
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
      order_fills: false,
      usdc_deposits: true,
    });
    mocks.getNotificationChannelStatus.mockResolvedValue("blocked");
    mocks.updateProfileUser.mockResolvedValue({
      id: "user-1",
      telegram_id: "123",
      wallet_address: "0xabc",
      privy_user_id: "did:privy:user:123",
      username: "alice-updated",
      email: "alice@example.com",
      language: "ru",
    });
  });

  it("returns the authenticated profile and notification preferences", async () => {
    const response = createResponse();

    await handler(
      {
        method: "GET",
        headers: { authorization: "Bearer token" },
      },
      response,
    );

    expect(mocks.getProfileByPrivyUserId).toHaveBeenCalledWith(
      expect.any(Object),
      "did:privy:user:123",
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        profile: expect.objectContaining({
          id: "user-1",
          username: "alice",
        }),
        notificationPreferences: {
          liquidationAlerts: true,
          orderFills: false,
          usdcDeposits: true,
        },
        telegramDeliveryStatus: "blocked",
      },
    });
  });

  it("patches editable profile fields through the server boundary", async () => {
    const response = createResponse();

    await handler(
      {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: {
          username: " alice-updated ",
          language: "ru",
        },
      },
      response,
    );

    expect(mocks.updateProfileUser).toHaveBeenCalledWith(
      expect.any(Object),
      "did:privy:user:123",
      {
        username: "alice-updated",
        language: "ru",
      },
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        profile: expect.objectContaining({
          username: "alice-updated",
          language: "ru",
        }),
      },
    });
  });
});
