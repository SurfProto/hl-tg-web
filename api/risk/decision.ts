import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getPlatformConfig } from "../platform/_lib/config";
import {
  parseCustomerType,
  parseRiskFlags,
  requireDirection,
  requirePaymentMethod,
  requirePositiveNumber,
  requireString,
} from "../platform/_lib/request";
import { evaluateRiskDecision } from "../platform/_lib/risk";
import { persistRiskDecision } from "../platform/_lib/supabase-admin";

interface RiskDecisionBody {
  amount?: number | string;
  country?: string;
  currency?: string;
  customerType?: string;
  direction?: string;
  paymentMethod?: string;
  riskFlags?: unknown[];
  transactionId?: string | null;
}

function requireAdminKey(request: any, expected: string | null) {
  const actual = request.headers["x-platform-admin-key"] ?? request.headers["X-Platform-Admin-Key"];
  if (!expected || actual !== expected) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid platform admin key");
  }
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getPlatformConfig();
    requireAdminKey(request, config.platformAdminKey);

    const body = parseJsonBody<RiskDecisionBody>(request);
    const risk = evaluateRiskDecision({
      amount: requirePositiveNumber(body.amount, "amount"),
      country: requireString(body.country, "country").toUpperCase(),
      currency: requireString(body.currency, "currency").toUpperCase(),
      customerType: parseCustomerType(body.customerType),
      direction: requireDirection(body.direction),
      paymentMethod: requirePaymentMethod(body.paymentMethod),
      riskFlags: parseRiskFlags(body.riskFlags),
    });

    const transactionId = typeof body.transactionId === "string" && body.transactionId ? body.transactionId : null;
    const persisted = await persistRiskDecision(config, transactionId, risk);

    json(response, 200, {
      success: true,
      data: { risk: persisted },
    });
  });
}
