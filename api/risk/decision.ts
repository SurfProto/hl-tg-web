import { ensureMethod, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { requirePlatformAdminKey } from "../platform/_lib/admin-auth";
import { getPlatformConfig, isProhibitedCorridor } from "../platform/_lib/config";
import {
  requireDirection,
  requirePaymentMethod,
  requirePositiveNumber,
  requireString,
} from "../platform/_lib/request";
import { deriveRiskFlags } from "../platform/_lib/risk-derivation";
import { evaluateRiskDecision } from "../platform/_lib/risk";
import {
  getUserRiskProfile,
  getUserVelocity,
  persistRiskDecision,
} from "../platform/_lib/supabase-admin";

interface RiskDecisionBody {
  amount?: number | string;
  country?: string;
  currency?: string;
  direction?: string;
  paymentMethod?: string;
  transactionId?: string | null;
  userId?: string;
}

/**
 * Score a transaction on behalf of an operator.
 *
 * Risk flags are derived from the named user's stored screening record and
 * transaction history. This endpoint used to accept a `riskFlags` array in the
 * body, which meant the caller decided the outcome.
 */
export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getPlatformConfig();
    requirePlatformAdminKey(request, config.platformAdminKey);

    const body = parseJsonBody<RiskDecisionBody>(request);
    const amount = requirePositiveNumber(body.amount, "amount");
    const country = requireString(body.country, "country").toUpperCase();
    const currency = requireString(body.currency, "currency").toUpperCase();
    const direction = requireDirection(body.direction);
    const paymentMethod = requirePaymentMethod(body.paymentMethod);
    const userId = requireString(body.userId, "userId");

    const [profile, velocity] = await Promise.all([
      getUserRiskProfile(config, userId),
      getUserVelocity(config, userId),
    ]);

    const decision = evaluateRiskDecision({
      amount,
      country,
      currency,
      customerType: "consumer",
      direction,
      paymentMethod,
      prohibitedCorridor: isProhibitedCorridor(config, country),
      riskFlags: deriveRiskFlags({
        amount,
        country,
        direction,
        highRiskCountries: config.highRiskCountries,
        profile,
        velocity,
      }),
    });

    const transactionId = typeof body.transactionId === "string" ? body.transactionId : null;
    await persistRiskDecision(config, transactionId, decision);

    json(response, 200, {
      success: true,
      data: { decision },
    });
  });
}
