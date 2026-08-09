import { describe, expect, it } from "vitest";

import { signQuoteToken, verifyQuoteToken, type QuoteClaims } from "./quote-token";

const SECRET = "quote-secret";

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

describe("quote tokens", () => {
  it("round-trips the claims it was given", () => {
    const token = signQuoteToken(claims(), SECRET);
    expect(verifyQuoteToken(token, SECRET)).toMatchObject({
      cryptoAmount: 1.96,
      ownerId: "user-1",
    });
  });

  it("rejects a payload swapped under a valid signature", () => {
    const signature = signQuoteToken(claims(), SECRET).split(".")[1];
    const forged = Buffer.from(
      JSON.stringify(claims({ cryptoAmount: 999_999 })),
      "utf8",
    ).toString("base64url");

    expect(() => verifyQuoteToken(`${forged}.${signature}`, SECRET)).toThrowError(
      /signature is invalid/,
    );
  });

  it("rejects a token signed with a different secret", () => {
    const token = signQuoteToken(claims(), "other-secret");
    expect(() => verifyQuoteToken(token, SECRET)).toThrowError(/signature is invalid/);
  });

  it("rejects an expired token", () => {
    const token = signQuoteToken(claims({ expiresAt: 1 }), SECRET);
    expect(() => verifyQuoteToken(token, SECRET)).toThrowError(/expired/);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyQuoteToken("garbage", SECRET)).toThrowError(/malformed/);
  });
});
