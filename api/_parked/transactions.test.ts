import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  rateLimitPlatform: vi.fn(),
  createPlatformTransaction: vi.fn(),
  getMerchantByApiKey: vi.fn(),
  getPlatformUserByPrivyUserId: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({
  requirePrivySession: mocks.requirePrivySession,
}));

vi.mock("../platform/_lib/rate-limit", () => ({
  rateLimitPlatform: mocks.rateLimitPlatform,
}));

vi.mock("../platform/_lib/supabase-admin", () => ({
  createPlatformTransaction: mocks.createPlatformTransaction,
  getMerchantByApiKey: mocks.getMerchantByApiKey,
  getPlatformUserByPrivyUserId: mocks.getPlatformUserByPrivyUserId,
}));

import { signQuoteToken, type QuoteClaims } from "../platform/_lib/quote-token";
import handler from "./transactions";

const SECRET = "quote-secret";

function createResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function claims(overrides: Partial<QuoteClaims> = {}): QuoteClaims {
  return {
    amount: 1000,
    country: "KZ",
    cryptoAmount: 1.96,
    cryptoAsset: "USDT",
    direction: "onramp",
    expiresAt: Math.floor(Date.now() / 1000) + 120,
    feeAmount: 20,
    fiatCurrency: "KZT",
    ownerId: "user-1",
    paymentMethod: "bank_transfer",
    provider: "provider-a",
    railId: "rail-1",
    risk: { action: "allow", caseRequired: false, reasonCode: "LOW_RISK", score: 0 },
    ...overrides,
  };
}

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer token", ...headers },
    body,
  };
}

describe("/api/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("PLATFORM_QUOTE_SECRET", SECRET);

    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:1" });
    mocks.rateLimitPlatform.mockResolvedValue(undefined);
    mocks.getPlatformUserByPrivyUserId.mockResolvedValue({ id: "user-1" });
    mocks.getMerchantByApiKey.mockResolvedValue(null);
    mocks.createPlatformTransaction.mockImplementation(
      async (_config: unknown, input: Record<string, unknown>) => ({
        id: "txn-1",
        ...input,
      }),
    );
  });

  it("books the amounts from the signed quote, not from the request body", async () => {
    const response = createResponse();

    await handler(
      request({
        // These are the values an attacker would want honoured. The handler
        // must ignore every one of them.
        amount: 1,
        cryptoAmount: 1_000_000,
        cryptoAsset: "BTC",
        feeAmount: 0,
        idempotencyKey: "key-1",
        quoteToken: signQuoteToken(claims(), SECRET),
      }),
      response,
    );

    expect(mocks.createPlatformTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        cryptoAmount: 1.96,
        cryptoAsset: "USDT",
        feeAmount: 20,
        grossAmount: 1000,
        railId: "rail-1",
        userId: "user-1",
      }),
    );
  });

  it("rejects a quote issued to another account", async () => {
    const response = createResponse();

    await handler(
      request({
        idempotencyKey: "key-1",
        quoteToken: signQuoteToken(claims({ ownerId: "user-2" }), SECRET),
      }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(mocks.createPlatformTransaction).not.toHaveBeenCalled();
  });

  it("rejects a tampered quote token", async () => {
    const token = signQuoteToken(claims(), SECRET);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify(claims({ cryptoAmount: 999_999 })),
      "utf8",
    ).toString("base64url");
    const response = createResponse();

    await handler(
      request({ idempotencyKey: "key-1", quoteToken: `${forged}.${signature}` }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json.mock.calls[0][0].code).toBe("INVALID_QUOTE");
    expect(mocks.createPlatformTransaction).not.toHaveBeenCalled();
    expect(payload).not.toBe(forged);
  });

  it("rejects an expired quote", async () => {
    const response = createResponse();

    await handler(
      request({
        idempotencyKey: "key-1",
        quoteToken: signQuoteToken(
          claims({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
          SECRET,
        ),
      }),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json.mock.calls[0][0].code).toBe("QUOTE_EXPIRED");
  });

  it("never takes merchantId from the body", async () => {
    const response = createResponse();

    await handler(
      request({
        idempotencyKey: "key-1",
        merchantId: "11111111-1111-1111-1111-111111111111",
        quoteToken: signQuoteToken(claims(), SECRET),
      }),
      response,
    );

    expect(mocks.createPlatformTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ merchantId: null }),
    );
  });

  it("resolves a merchant from its API key and rejects an unknown one", async () => {
    const response = createResponse();

    await handler(
      request(
        { idempotencyKey: "key-1", quoteToken: signQuoteToken(claims(), SECRET) },
        { "x-merchant-api-key": "nope" },
      ),
      response,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.createPlatformTransaction).not.toHaveBeenCalled();
  });

  it("holds instead of creating when the quote carries a hold decision", async () => {
    const response = createResponse();

    await handler(
      request({
        idempotencyKey: "key-1",
        quoteToken: signQuoteToken(
          claims({
            risk: {
              action: "hold",
              caseRequired: true,
              reasonCode: "SANCTIONS_OR_PEP_MATCH",
              score: 90,
            },
          }),
          SECRET,
        ),
      }),
      response,
    );

    expect(mocks.createPlatformTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        riskAction: "hold",
        riskCaseRequired: true,
        riskReasonCode: "SANCTIONS_OR_PEP_MATCH",
        riskScore: 90,
        status: "held",
      }),
    );
  });
});
