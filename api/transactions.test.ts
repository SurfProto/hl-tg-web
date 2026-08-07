import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getPlatformConfig: vi.fn(),
  getPlatformUserByPrivyUserId: vi.fn(),
  getPaymentRails: vi.fn(),
  persistRiskDecision: vi.fn(),
  upsertPlatformTransactionWithLedger: vi.fn(),
}));

vi.mock("./onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("./platform/_lib/config", () => ({
  getPlatformConfig: mocks.getPlatformConfig,
}));

vi.mock("./platform/_lib/supabase-admin", () => ({
  getPaymentRails: mocks.getPaymentRails,
  getPlatformUserByPrivyUserId: mocks.getPlatformUserByPrivyUserId,
  persistRiskDecision: mocks.persistRiskDecision,
  upsertPlatformTransactionWithLedger: mocks.upsertPlatformTransactionWithLedger,
}));

import handler from "./transactions";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("/api/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlatformConfig.mockReturnValue({ privyAppId: "privy-app" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user" });
    mocks.getPlatformUserByPrivyUserId.mockResolvedValue({ id: "user-1" });
    mocks.getPaymentRails.mockResolvedValue([
      {
        id: "rail-ru-card",
        country: "RU",
        currency: "RUB",
        direction: "onramp",
        paymentMethod: "card",
        provider: "provider",
        fixedFee: 20,
        percentageFeeBps: 100,
        successRateBps: 9500,
        settlementDelayMinutes: 15,
        health: "healthy",
        enabled: true,
      },
    ]);
    mocks.upsertPlatformTransactionWithLedger.mockResolvedValue({
      id: "txn_1",
      idempotencyKey: "idem-1",
      status: "created",
      riskAction: "allow",
      riskReasonCode: "LOW_RISK",
    });
    mocks.persistRiskDecision.mockResolvedValue({
      action: "allow",
      reasonCode: "LOW_RISK",
    });
  });

  it("creates an idempotent canonical transaction with a routed rail and risk decision", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          idempotencyKey: "idem-1",
          amount: 10000,
          cryptoAmount: 100,
          country: "RU",
          fiatCurrency: "RUB",
          cryptoAsset: "USDT",
          direction: "onramp",
          paymentMethod: "card",
          riskFlags: [],
        },
      },
      response,
    );

    expect(mocks.upsertPlatformTransactionWithLedger).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: "idem-1",
        railId: "rail-ru-card",
        riskAction: "allow",
        status: "created",
        userId: "user-1",
      }),
    );
    expect(mocks.persistRiskDecision).toHaveBeenCalledWith(
      expect.any(Object),
      "txn_1",
      expect.objectContaining({
        action: "allow",
        reasonCode: "LOW_RISK",
      }),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        transaction: expect.objectContaining({
          id: "txn_1",
          idempotencyKey: "idem-1",
        }),
      },
    });
  });
});
