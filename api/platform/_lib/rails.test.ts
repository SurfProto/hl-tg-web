import { describe, expect, it } from "vitest";

import { routeQuote } from "./rails";

describe("routeQuote", () => {
  it("chooses the best healthy rail for the requested CIS corridor", () => {
    const quote = routeQuote({
      amount: 100000,
      country: "KZ",
      currency: "KZT",
      direction: "onramp",
      paymentMethod: "bank_transfer",
      rails: [
        {
          id: "slow-expensive",
          country: "KZ",
          currency: "KZT",
          direction: "onramp",
          paymentMethod: "bank_transfer",
          provider: "provider-a",
          fixedFee: 100,
          percentageFeeBps: 100,
          successRateBps: 9800,
          settlementDelayMinutes: 1440,
          health: "healthy",
          enabled: true,
        },
        {
          id: "fast-cheap",
          country: "KZ",
          currency: "KZT",
          direction: "onramp",
          paymentMethod: "bank_transfer",
          provider: "provider-b",
          fixedFee: 50,
          percentageFeeBps: 40,
          successRateBps: 9600,
          settlementDelayMinutes: 60,
          health: "healthy",
          enabled: true,
        },
      ],
    });

    expect(quote.railId).toBe("fast-cheap");
    expect(quote.totalFee).toBe(450);
    expect(quote.netAmount).toBe(99550);
  });

  it("falls back around disabled and degraded rails", () => {
    const quote = routeQuote({
      amount: 5000,
      country: "UZ",
      currency: "UZS",
      direction: "offramp",
      paymentMethod: "card",
      rails: [
        {
          id: "disabled",
          country: "UZ",
          currency: "UZS",
          direction: "offramp",
          paymentMethod: "card",
          provider: "provider-a",
          fixedFee: 0,
          percentageFeeBps: 0,
          successRateBps: 9999,
          settlementDelayMinutes: 10,
          health: "healthy",
          enabled: false,
        },
        {
          id: "degraded",
          country: "UZ",
          currency: "UZS",
          direction: "offramp",
          paymentMethod: "card",
          provider: "provider-b",
          fixedFee: 0,
          percentageFeeBps: 0,
          successRateBps: 9999,
          settlementDelayMinutes: 10,
          health: "degraded",
          enabled: true,
        },
        {
          id: "healthy",
          country: "UZ",
          currency: "UZS",
          direction: "offramp",
          paymentMethod: "card",
          provider: "provider-c",
          fixedFee: 10,
          percentageFeeBps: 10,
          successRateBps: 9000,
          settlementDelayMinutes: 30,
          health: "healthy",
          enabled: true,
        },
      ],
    });

    expect(quote.railId).toBe("healthy");
  });

  it("returns no route when the corridor is unsupported", () => {
    expect(
      routeQuote({
        amount: 100,
        country: "KG",
        currency: "KGS",
        direction: "onramp",
        paymentMethod: "bank_transfer",
        rails: [],
      }),
    ).toBeNull();
  });
});
