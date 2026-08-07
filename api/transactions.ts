import { requirePrivySession } from "./onramp/_lib/auth";
import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "./onramp/_lib/http";
import { getPlatformConfig } from "./platform/_lib/config";
import {
  optionalString,
  parseCustomerType,
  parseRiskFlags,
  requireDirection,
  requirePaymentMethod,
  requirePositiveNumber,
  requireString,
} from "./platform/_lib/request";
import { evaluateRiskDecision } from "./platform/_lib/risk";
import { routeQuote } from "./platform/_lib/rails";
import {
  getPaymentRails,
  getPlatformUserByPrivyUserId,
  persistRiskDecision,
  upsertPlatformTransactionWithLedger,
} from "./platform/_lib/supabase-admin";
import type { TransactionStatus } from "./platform/_lib/types";

interface TransactionBody {
  amount?: number | string;
  country?: string;
  cryptoAmount?: number | string;
  cryptoAsset?: string;
  customerType?: string;
  direction?: string;
  fiatCurrency?: string;
  idempotencyKey?: string;
  merchantId?: string | null;
  metadata?: Record<string, unknown>;
  paymentMethod?: string;
  providerOrderId?: string | null;
  riskFlags?: unknown[];
}

function statusForRisk(action: string): TransactionStatus {
  if (action === "hold" || action === "freeze") {
    return "held";
  }
  if (action === "reject") {
    return "failed";
  }
  return "created";
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getPlatformConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const user = await getPlatformUserByPrivyUserId(config, session.privyUserId);
    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "Open the app first to initialize your profile");
    }

    const body = parseJsonBody<TransactionBody>(request);
    const grossAmount = requirePositiveNumber(body.amount, "amount");
    const cryptoAmount = requirePositiveNumber(body.cryptoAmount, "cryptoAmount");
    const country = requireString(body.country, "country").toUpperCase();
    const fiatCurrency = requireString(body.fiatCurrency, "fiatCurrency").toUpperCase();
    const cryptoAsset = requireString(body.cryptoAsset, "cryptoAsset").toUpperCase();
    const direction = requireDirection(body.direction);
    const paymentMethod = requirePaymentMethod(body.paymentMethod);
    const customerType = parseCustomerType(body.customerType);
    const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");
    const riskFlags = parseRiskFlags(body.riskFlags);

    const quote = routeQuote({
      amount: grossAmount,
      country,
      currency: fiatCurrency,
      direction,
      paymentMethod,
      rails: await getPaymentRails(config),
    });
    if (!quote) {
      throw new HttpError(422, "NO_RAIL_AVAILABLE", "No healthy payment rail supports this corridor");
    }

    const risk = evaluateRiskDecision({
      amount: grossAmount,
      country,
      currency: fiatCurrency,
      customerType,
      direction,
      paymentMethod,
      riskFlags,
    });

    const transaction = await upsertPlatformTransactionWithLedger(config, {
      country,
      cryptoAmount,
      cryptoAsset,
      direction,
      feeAmount: quote.totalFee,
      fiatCurrency,
      grossAmount,
      idempotencyKey,
      merchantId: optionalString(body.merchantId),
      metadata: body.metadata ?? {},
      paymentMethod,
      provider: quote.provider,
      providerOrderId: optionalString(body.providerOrderId),
      railId: quote.railId,
      riskAction: risk.action,
      riskReasonCode: risk.reasonCode,
      status: statusForRisk(risk.action),
      userId: user.id,
    });
    await persistRiskDecision(config, transaction.id, risk);

    json(response, 200, {
      success: true,
      data: { transaction },
    });
  });
}
