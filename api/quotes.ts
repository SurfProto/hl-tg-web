import { requirePrivySession } from "./onramp/_lib/auth";
import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "./onramp/_lib/http";
import { getPlatformConfig } from "./platform/_lib/config";
import {
  parseCustomerType,
  parseRiskFlags,
  requireDirection,
  requirePaymentMethod,
  requirePositiveNumber,
  requireString,
} from "./platform/_lib/request";
import { evaluateRiskDecision } from "./platform/_lib/risk";
import { routeQuote } from "./platform/_lib/rails";
import { getPaymentRails } from "./platform/_lib/supabase-admin";

interface QuoteBody {
  amount?: number | string;
  country?: string;
  currency?: string;
  customerType?: string;
  direction?: string;
  paymentMethod?: string;
  riskFlags?: unknown[];
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getPlatformConfig();
    await requirePrivySession(request, config.privyAppId);

    const body = parseJsonBody<QuoteBody>(request);
    const amount = requirePositiveNumber(body.amount, "amount");
    const country = requireString(body.country, "country").toUpperCase();
    const currency = requireString(body.currency, "currency").toUpperCase();
    const direction = requireDirection(body.direction);
    const paymentMethod = requirePaymentMethod(body.paymentMethod);
    const customerType = parseCustomerType(body.customerType);
    const riskFlags = parseRiskFlags(body.riskFlags);

    const quote = routeQuote({
      amount,
      country,
      currency,
      direction,
      paymentMethod,
      rails: await getPaymentRails(config),
    });
    if (!quote) {
      throw new HttpError(422, "NO_RAIL_AVAILABLE", "No healthy payment rail supports this corridor");
    }

    const risk = evaluateRiskDecision({
      amount,
      country,
      currency,
      customerType,
      direction,
      paymentMethod,
      riskFlags,
    });

    json(response, 200, {
      success: true,
      data: { quote, risk },
    });
  });
}
