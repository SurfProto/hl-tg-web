import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getProfileConfig: vi.fn(),
  upsertNotificationPreferences: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("./_lib/config", () => ({
  getProfileConfig: mocks.getProfileConfig,
}));

vi.mock("./_lib/supabase-admin", () => ({
  upsertNotificationPreferences: mocks.upsertNotificationPreferences,
}));

import handler from "./notifications";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("PATCH /api/profile/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileConfig.mockReturnValue({
      privyAppId: "privy-app-id",
    });
    mocks.requirePrivySession.mockResolvedValue({
      privyUserId: "did:privy:user:123",
    });
    mocks.upsertNotificationPreferences.mockResolvedValue({
      liquidation_alerts: false,
      order_fills: true,
      usdc_deposits: false,
    });
  });

  it("updates notification preferences through the service boundary", async () => {
    const response = createResponse();

    await handler(
      {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: {
          liquidationAlerts: false,
          orderFills: true,
          usdcDeposits: false,
        },
      },
      response,
    );

    expect(mocks.upsertNotificationPreferences).toHaveBeenCalledWith(
      expect.any(Object),
      "did:privy:user:123",
      {
        liquidationAlerts: false,
        orderFills: true,
        usdcDeposits: false,
      },
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        notificationPreferences: {
          liquidationAlerts: false,
          orderFills: true,
          usdcDeposits: false,
        },
      },
    });
  });
});
