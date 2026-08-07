import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatformConfig: vi.fn(),
  persistRiskDecision: vi.fn(),
}));

vi.mock("../platform/_lib/config", () => ({
  getPlatformConfig: mocks.getPlatformConfig,
}));

vi.mock("../platform/_lib/supabase-admin", () => ({
  persistRiskDecision: mocks.persistRiskDecision,
}));

import handler from "./decision";

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("/api/risk/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlatformConfig.mockReturnValue({ platformAdminKey: "admin-key" });
    mocks.persistRiskDecision.mockResolvedValue({
      action: "hold",
      reasonCode: "SANCTIONS_OR_PEP_MATCH",
    });
  });

  it("requires the internal admin key and persists case-worthy risk decisions", async () => {
    const response = createResponse();

    await handler(
      {
        method: "POST",
        headers: { "x-platform-admin-key": "admin-key" },
        body: {
          transactionId: "txn_1",
          amount: 100,
          country: "KZ",
          currency: "KZT",
          customerType: "consumer",
          direction: "onramp",
          paymentMethod: "card",
          riskFlags: ["sanctions_match"],
        },
      },
      response,
    );

    expect(mocks.persistRiskDecision).toHaveBeenCalledWith(
      expect.any(Object),
      "txn_1",
      expect.objectContaining({
        action: "hold",
        caseRequired: true,
      }),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        risk: expect.objectContaining({
          action: "hold",
          reasonCode: "SANCTIONS_OR_PEP_MATCH",
        }),
      },
    });
  });
});
