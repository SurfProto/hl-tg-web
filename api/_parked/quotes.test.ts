import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  rateLimitPlatform: vi.fn(),
  getPaymentRails: vi.fn(),
  getPlatformUserByPrivyUserId: vi.fn(),
  getReferenceRate: vi.fn(),
  getUserRiskProfile: vi.fn(),
  getUserVelocity: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("../platform/_lib/rate-limit", () => ({
  rateLimitPlatform: mocks.rateLimitPlatform,
}));

vi.mock("../platform/_lib/supabase-admin", () => ({
  getPaymentRails: mocks.getPaymentRails,
  getPlatformUserByPrivyUserId: mocks.getPlatformUserByPrivyUserId,
  getReferenceRate: mocks.getReferenceRate,
  getUserRiskProfile: mocks.getUserRiskProfile,
  getUserVelocity: mocks.getUserVelocity,
}));

import { verifyQuoteToken } from "../platform/_lib/quote-token";
import handler from "./quotes";

const SECRET = "quote-secret";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    amount: 1000,
    country: "KZ",
    cryptoAsset: "USDT",
    currency: "KZT",
    direction: "onramp",
    paymentMethod: "bank_transfer",
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: body(overrides),
  };
}

const RAIL = {
  country: "KZ",
  currency: "KZT",
  direction: "onramp",
  enabled: true,
  fixedFee: 10,
  health: "healthy",
  id: "rail-1",
  maxAmount: null,
  minAmount: null,
  paymentMethod: "bank_transfer",
  percentageFeeBps: 100,
  provider: "provider-a",
  settlementDelayMinutes: 30,
  successRateBps: 9900,
};

describe("/api/quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("PLATFORM_QUOTE_SECRET", SECRET);
    vi.stubEnv("PLATFORM_HIGH_RISK_COUNTRIES", "");
    vi.stubEnv("PLATFORM_PROHIBITED_COUNTRIES", "");

    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:1" });
    mocks.rateLimitPlatform.mockResolvedValue(undefined);
    mocks.getPlatformUserByPrivyUserId.mockResolvedValue({ id: "user-1" });
    mocks.getPaymentRails.mockResolvedValue([RAIL]);
    mocks.getReferenceRate.mockResolvedValue({
      cryptoAsset: "USDT",
      fiatCurrency: "KZT",
      observedAt: new Date().toISOString(),
      rate: 0.002,
    });
    mocks.getUserRiskProfile.mockResolvedValue({
      adverseMedia: false,
      blockchainExposure: false,
      chargebackHistory: false,
      pepMatch: false,
      sanctionsMatch: false,
      screenedAt: new Date().toISOString(),
      userId: "user-1",
    });
    mocks.getUserVelocity.mockResolvedValue({ grossAmount24h: 0, transactionCount24h: 0 });
  });

  it("prices the crypto leg server-side and signs it into the quote token", async () => {
    const response = createResponse();

    await handler(request(), response);

    const payload = response.json.mock.calls[0][0];
    expect(payload.success).toBe(true);

    // fee = 10 + 1000 * 100/10000 = 20; net = 980; crypto = 980 * 0.002
    expect(payload.data.quote.totalFee).toBe(20);
    expect(payload.data.quote.cryptoAmount).toBe(1.96);

    const claims = verifyQuoteToken(payload.data.quoteToken, SECRET);
    expect(claims.cryptoAmount).toBe(1.96);
    expect(claims.ownerId).toBe("user-1");
    expect(claims.risk.action).toBe("allow");
  });

  it("ignores riskFlags supplied by the caller", async () => {
    const response = createResponse();

    // The old endpoint scored whatever the body claimed, so passing nothing
    // guaranteed "allow" and passing a flag was the only way to raise it.
    // Flags now come from the stored screening record.
    mocks.getUserRiskProfile.mockResolvedValue({
      adverseMedia: false,
      blockchainExposure: false,
      chargebackHistory: false,
      pepMatch: true,
      sanctionsMatch: false,
      screenedAt: new Date().toISOString(),
      userId: "user-1",
    });

    await handler(request({ riskFlags: [] }), response);

    const payload = response.json.mock.calls[0][0];
    expect(payload.data.risk.action).toBe("hold");
    expect(payload.data.risk.reasonCode).toBe("SANCTIONS_OR_PEP_MATCH");
  });

  it("treats a customer with no screening record as review, not allow", async () => {
    mocks.getUserRiskProfile.mockResolvedValue(null);
    const response = createResponse();

    await handler(request(), response);

    const payload = response.json.mock.calls[0][0];
    expect(payload.data.risk.action).toBe("review");
  });

  it("refuses to quote when no reference rate is configured", async () => {
    mocks.getReferenceRate.mockResolvedValue(null);
    const response = createResponse();

    await handler(request(), response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json.mock.calls[0][0].code).toBe("NO_REFERENCE_RATE");
  });

  it("returns an explicit error when no local rail supports the corridor", async () => {
    mocks.getPaymentRails.mockResolvedValue([]);
    const response = createResponse();

    await handler(request(), response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json.mock.calls[0][0].code).toBe("NO_RAIL_AVAILABLE");
  });
});
