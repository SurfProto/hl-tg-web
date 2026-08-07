import { describe, expect, it } from "vitest";

import { evaluateRiskDecision } from "./risk";

describe("evaluateRiskDecision", () => {
  it("allows normal low-risk consumer transactions", () => {
    expect(
      evaluateRiskDecision({
        amount: 1000,
        country: "KZ",
        currency: "KZT",
        customerType: "consumer",
        direction: "onramp",
        paymentMethod: "card",
        riskFlags: [],
      }),
    ).toMatchObject({
      action: "allow",
      reasonCode: "LOW_RISK",
      caseRequired: false,
    });
  });

  it("holds sanctions and PEP matches for manual review", () => {
    expect(
      evaluateRiskDecision({
        amount: 100,
        country: "UZ",
        currency: "UZS",
        customerType: "consumer",
        direction: "offramp",
        paymentMethod: "bank_transfer",
        riskFlags: ["sanctions_match", "pep_match"],
      }),
    ).toMatchObject({
      action: "hold",
      reasonCode: "SANCTIONS_OR_PEP_MATCH",
      caseRequired: true,
    });
  });

  it("reviews high-value and high-risk payment activity without freezing by default", () => {
    expect(
      evaluateRiskDecision({
        amount: 75000,
        country: "AM",
        currency: "AMD",
        customerType: "merchant",
        direction: "merchant_payment",
        paymentMethod: "mobile_money",
        riskFlags: ["velocity_spike"],
      }),
    ).toMatchObject({
      action: "review",
      reasonCode: "HIGH_VALUE_OR_VELOCITY",
      caseRequired: true,
    });
  });
});
