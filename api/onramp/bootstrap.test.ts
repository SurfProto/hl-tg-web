import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getOnrampConfig: vi.fn(),
  getUserByPrivyUserId: vi.fn(),
  getActiveOrder: vi.fn(),
  getRecentOrders: vi.fn(),
  hasVerifiedEmail: vi.fn(),
  upsertOnrampUser: vi.fn(),
}));

vi.mock("./_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./_lib/config", () => ({ getOnrampConfig: mocks.getOnrampConfig }));
vi.mock("./_lib/supabase-admin", () => ({
  getUserByPrivyUserId: mocks.getUserByPrivyUserId,
  getActiveOrder: mocks.getActiveOrder,
  getRecentOrders: mocks.getRecentOrders,
  hasVerifiedEmail: mocks.hasVerifiedEmail,
  upsertOnrampUser: mocks.upsertOnrampUser,
}));

import handler from "./bootstrap";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe("POST /api/onramp/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOnrampConfig.mockReturnValue({
      privyAppId: "app-id",
      serviceId: "service",
      appSymbol: "RUB-USDT",
      network: "TRC20",
    });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
    mocks.getUserByPrivyUserId.mockResolvedValue({
      id: "user-1",
      email: "canonical@example.com",
      wallet_address: "0xcanonical",
      kyc_id: null,
      kyc_status: null,
    });
    mocks.hasVerifiedEmail.mockResolvedValue(true);
    mocks.getActiveOrder.mockResolvedValue(null);
    mocks.getRecentOrders.mockResolvedValue([]);
  });

  it("loads stored identity without persisting client payout or email fields", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { email: "attacker@example.com", walletAddress: "TAttackerPayout" },
      },
      response,
    );

    expect(mocks.getUserByPrivyUserId).toHaveBeenCalledWith(
      expect.anything(),
      "did:privy:user:1",
    );
    expect(mocks.upsertOnrampUser).not.toHaveBeenCalled();
    expect(mocks.hasVerifiedEmail).toHaveBeenCalledWith(
      expect.anything(),
      "canonical@example.com",
    );
  });
});
