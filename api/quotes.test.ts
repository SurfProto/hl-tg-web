import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getPlatformConfig: vi.fn(),
  getPaymentRails: vi.fn(),
}));

vi.mock("./onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("./platform/_lib/config", () => ({
  getPlatformConfig: mocks.getPlatformConfig,
}));

vi.mock("./platform/_lib/supabase-admin", () => ({
  getPaymentRails: mocks.getPaymentRails,
}));

import handler from "./quotes";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("/api/quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlatformConfig.mockReturnValue({ privyAppId: "privy-app" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user" });
    mocks.getPaymentRails.mockResolvedValue([
      {
        id: "rail-kz-card",
        country: "KZ",
        currency: "KZT",
        direction: "onramp",
        paymentMethod: "card",
        provider: "local-provider",
        fixedFee: 50,
        percentageFeeBps: 100,
        successRateBps: 9500,
        settlementDelayMinutes: 30,
        health: "healthy",
        enabled: true,
      },
    ]);
  });

  it("returns a routed quote with risk context", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          amount: 10000,
          country: "KZ",
          currency: "KZT",
          direction: "onramp",
          paymentMethod: "card",
          riskFlags: [],
        },
      },
      response,
    );

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        quote: expect.objectContaining({
          railId: "rail-kz-card",
          totalFee: 150,
          netAmount: 9850,
        }),
        risk: expect.objectContaining({
          action: "allow",
          reasonCode: "LOW_RISK",
        }),
      },
    });
  });

  it("returns an explicit error when no local rail supports the corridor", async () => {
    mocks.getPaymentRails.mockResolvedValue([]);
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          amount: 10000,
          country: "KG",
          currency: "KGS",
          direction: "onramp",
          paymentMethod: "bank_transfer",
        },
      },
      response,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "NO_RAIL_AVAILABLE",
      }),
    );
  });
});
