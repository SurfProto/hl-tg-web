import type { RiskDecision, RiskDecisionInput, RiskFlag } from "./types";

const HARD_HOLD_FLAGS = new Set<RiskFlag>(["sanctions_match", "pep_match"]);
const REVIEW_FLAGS = new Set<RiskFlag>([
  "adverse_media",
  "velocity_spike",
  "device_mismatch",
  "chargeback_history",
  "blockchain_exposure",
  "high_risk_country",
]);

function flagScore(flag: RiskFlag): number {
  if (HARD_HOLD_FLAGS.has(flag)) {
    return 90;
  }
  if (flag === "chargeback_history" || flag === "blockchain_exposure") {
    return 45;
  }
  if (REVIEW_FLAGS.has(flag)) {
    return 30;
  }
  return 0;
}

export function evaluateRiskDecision(input: RiskDecisionInput): RiskDecision {
  const flagRisk = input.riskFlags.reduce((sum, flag) => sum + flagScore(flag), 0);
  const amountRisk = input.amount >= 50000 ? 35 : input.amount >= 10000 ? 15 : 0;
  const merchantRisk = input.customerType === "merchant" || input.direction === "merchant_payment" ? 10 : 0;
  const score = Math.min(100, flagRisk + amountRisk + merchantRisk);

  if (input.riskFlags.some((flag) => HARD_HOLD_FLAGS.has(flag))) {
    return {
      action: "hold",
      caseRequired: true,
      reasonCode: "SANCTIONS_OR_PEP_MATCH",
      score,
    };
  }

  if (score >= 90) {
    return {
      action: "freeze",
      caseRequired: true,
      reasonCode: "CRITICAL_RISK_SCORE",
      score,
    };
  }

  if (score >= 35) {
    return {
      action: "review",
      caseRequired: true,
      reasonCode: "HIGH_VALUE_OR_VELOCITY",
      score,
    };
  }

  return {
    action: "allow",
    caseRequired: false,
    reasonCode: "LOW_RISK",
    score,
  };
}
