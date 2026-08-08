import { describe, expect, it } from "vitest";

import { evaluateRiskDecision, REVIEW_THRESHOLD } from "./risk";
import type { RiskFlag } from "./types";

function decide(riskFlags: RiskFlag[], amount = 100) {
  return evaluateRiskDecision({
    amount,
    country: "KZ",
    currency: "KZT",
    customerType: "consumer",
    direction: "onramp",
    paymentMethod: "card",
    riskFlags,
  });
}

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

  // Every review-tier flag used to score 30 against a threshold of 35, so a
  // lone velocity spike, high-risk country or adverse-media hit came back
  // "allow". Each must clear the bar on its own.
  it.each<RiskFlag>([
    "adverse_media",
    "velocity_spike",
    "device_mismatch",
    "chargeback_history",
    "blockchain_exposure",
    "high_risk_country",
    "unscreened",
  ])("routes a lone %s flag to review on a small transaction", (flag) => {
    const decision = decide([flag]);
    expect(decision.score).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(decision.action).not.toBe("allow");
  });

  it("rejects a prohibited corridor without offering a review path", () => {
    expect(
      evaluateRiskDecision({
        amount: 100,
        country: "XX",
        currency: "USD",
        customerType: "consumer",
        direction: "onramp",
        paymentMethod: "card",
        prohibitedCorridor: true,
        riskFlags: [],
      }),
    ).toMatchObject({
      action: "reject",
      reasonCode: "PROHIBITED_CORRIDOR",
      caseRequired: false,
    });
  });
});
