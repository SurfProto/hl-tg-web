import type { RiskDecision, RiskDecisionInput, RiskFlag } from "./types";

const HARD_HOLD_FLAGS = new Set<RiskFlag>(["sanctions_match", "pep_match"]);
const REVIEW_FLAGS = new Set<RiskFlag>([
  "adverse_media",
  "velocity_spike",
  "device_mismatch",
  "chargeback_history",
  "blockchain_exposure",
  "high_risk_country",
  "unscreened",
]);

// A prohibited corridor is a hard no rather than something a reviewer can wave
// through. Nothing produced "reject" before, so the status existed in the
// schema with no path to it.
const REJECT_FLAGS = new Set<RiskFlag>([]);

export const REVIEW_THRESHOLD = 35;
export const FREEZE_THRESHOLD = 90;

// Flags in REVIEW_FLAGS used to score 30 against a review threshold of 35, so
// none of them could trigger a review on its own — a velocity spike, a
// high-risk country or an adverse-media hit all scored below the bar and came
// back "allow". Every review-tier flag now reaches the threshold, which is
// what the name always implied.
const REVIEW_FLAG_SCORE = REVIEW_THRESHOLD;
const ELEVATED_FLAG_SCORE = 45;

function flagScore(flag: RiskFlag): number {
  if (HARD_HOLD_FLAGS.has(flag)) {
    return FREEZE_THRESHOLD;
  }
  if (flag === "chargeback_history" || flag === "blockchain_exposure") {
    return ELEVATED_FLAG_SCORE;
  }
  if (REVIEW_FLAGS.has(flag)) {
    return REVIEW_FLAG_SCORE;
  }
  return 0;
}

export function evaluateRiskDecision(input: RiskDecisionInput): RiskDecision {
  const flagRisk = input.riskFlags.reduce((sum, flag) => sum + flagScore(flag), 0);
  const amountRisk = input.amount >= 50000 ? 35 : input.amount >= 10000 ? 15 : 0;
  const merchantRisk = input.customerType === "merchant" || input.direction === "merchant_payment" ? 10 : 0;
  const score = Math.min(100, flagRisk + amountRisk + merchantRisk);

  if (input.prohibitedCorridor || input.riskFlags.some((flag) => REJECT_FLAGS.has(flag))) {
    return {
      action: "reject",
      caseRequired: false,
      reasonCode: "PROHIBITED_CORRIDOR",
      score,
    };
  }

  if (input.riskFlags.some((flag) => HARD_HOLD_FLAGS.has(flag))) {
    return {
      action: "hold",
      caseRequired: true,
      reasonCode: "SANCTIONS_OR_PEP_MATCH",
      score,
    };
  }

  if (score >= FREEZE_THRESHOLD) {
    return {
      action: "freeze",
      caseRequired: true,
      reasonCode: "CRITICAL_RISK_SCORE",
      score,
    };
  }

  if (score >= REVIEW_THRESHOLD) {
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
