import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatformConfig: vi.fn(),
  isProhibitedCorridor: vi.fn(),
  getUserRiskProfile: vi.fn(),
  getUserVelocity: vi.fn(),
  persistRiskDecision: vi.fn(),
}));

vi.mock("../platform/_lib/config", () => ({
  getPlatformConfig: mocks.getPlatformConfig,
  isProhibitedCorridor: mocks.isProhibitedCorridor,
}));

vi.mock("../platform/_lib/supabase-admin", () => ({
  getUserRiskProfile: mocks.getUserRiskProfile,
  getUserVelocity: mocks.getUserVelocity,
  persistRiskDecision: mocks.persistRiskDecision,
}));

import handler from "./decision";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function request(body: Record<string, unknown>, adminKey = "admin-key") {
  return {
    method: "POST",
    headers: { "x-platform-admin-key": adminKey },
    body: {
      amount: 100,
      country: "KZ",
      currency: "KZT",
      direction: "onramp",
      paymentMethod: "card",
      userId: "user-1",
      ...body,
    },
  };
}

function cleanProfile() {
  return {
    adverseMedia: false,
    blockchainExposure: false,
    chargebackHistory: false,
    pepMatch: false,
    sanctionsMatch: false,
    screenedAt: new Date().toISOString(),
    userId: "user-1",
  };
}

describe("/api/risk/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlatformConfig.mockReturnValue({
      highRiskCountries: [],
      platformAdminKey: "admin-key",
    });
    mocks.isProhibitedCorridor.mockReturnValue(false);
    mocks.getUserRiskProfile.mockResolvedValue(cleanProfile());
    mocks.getUserVelocity.mockResolvedValue({ grossAmount24h: 0, transactionCount24h: 0 });
    mocks.persistRiskDecision.mockImplementation(
      async (_config: unknown, _transactionId: string | null, decision: unknown) => decision,
    );
  });

  it("rejects a request without the admin key", async () => {
    const response = createResponse();

    await handler(request({}, "wrong-key"), response);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.persistRiskDecision).not.toHaveBeenCalled();
  });

  it("derives a hold from the stored screening record, not the request body", async () => {
    mocks.getUserRiskProfile.mockResolvedValue({ ...cleanProfile(), sanctionsMatch: true });
    const response = createResponse();

    // riskFlags in the body is ignored entirely; it used to drive the outcome.
    await handler(request({ transactionId: "txn_1", riskFlags: [] }), response);

    expect(mocks.persistRiskDecision).toHaveBeenCalledWith(
      expect.any(Object),
      "txn_1",
      expect.objectContaining({ action: "hold", caseRequired: true }),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        decision: expect.objectContaining({
          action: "hold",
          reasonCode: "SANCTIONS_OR_PEP_MATCH",
        }),
      },
    });
  });

  it("flags a velocity spike from the user's own recent history", async () => {
    mocks.getUserVelocity.mockResolvedValue({
      grossAmount24h: 40_000,
      transactionCount24h: 3,
    });
    const response = createResponse();

    await handler(request({ amount: 100 }), response);

    expect(mocks.persistRiskDecision).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.objectContaining({ action: "review" }),
    );
  });

  it("rejects a prohibited corridor outright rather than sending it to review", async () => {
    mocks.isProhibitedCorridor.mockReturnValue(true);
    const response = createResponse();

    await handler(request({}), response);

    expect(mocks.persistRiskDecision).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.objectContaining({ action: "reject", reasonCode: "PROHIBITED_CORRIDOR" }),
    );
  });
});
