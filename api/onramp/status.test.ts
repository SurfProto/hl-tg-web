import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getOnrampConfig: vi.fn(),
  getOnrampOrder: vi.fn(),
  getActiveOrder: vi.fn(),
  getOwnedOrder: vi.fn(),
  getUserByPrivyUserId: vi.fn(),
  updateOwnedOrderStatus: vi.fn(),
}));

vi.mock("./_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./_lib/config", () => ({ getOnrampConfig: mocks.getOnrampConfig }));
vi.mock("./_lib/provider", () => ({ getOnrampOrder: mocks.getOnrampOrder }));
vi.mock("./_lib/supabase-admin", () => ({
  getActiveOrder: mocks.getActiveOrder,
  getOwnedOrder: mocks.getOwnedOrder,
  getUserByPrivyUserId: mocks.getUserByPrivyUserId,
  updateOwnedOrderStatus: mocks.updateOwnedOrderStatus,
}));

import handler from "./status";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe("GET /api/onramp/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOnrampConfig.mockReturnValue({ privyAppId: "app-id" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
    mocks.getUserByPrivyUserId.mockResolvedValue({
      id: "user-1",
      email: "canonical@example.com",
      wallet_address: "0xcanonical",
    });
  });

  it("rejects an unowned explicit provider ID before contacting the provider", async () => {
    mocks.getOwnedOrder.mockResolvedValue(null);
    const response = createResponse();

    await handler(
      {
        method: "GET",
        headers: { authorization: "Bearer token" },
        query: { order_id: "ord_other_user" },
      },
      response,
    );

    expect(mocks.getOwnedOrder).toHaveBeenCalled();
    expect(mocks.getOnrampOrder).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ORDER_NOT_FOUND" }),
    );
  });
});
