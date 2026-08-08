import { requirePrivySession } from "./onramp/_lib/auth";
import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "./onramp/_lib/http";
import { getPlatformConfig } from "./platform/_lib/config";
import { rateLimitPlatform } from "./platform/_lib/rate-limit";
import { optionalString, requireString } from "./platform/_lib/request";
import { verifyQuoteToken } from "./platform/_lib/quote-token";
import {
  createPlatformTransaction,
  getMerchantByApiKey,
  getPlatformUserByPrivyUserId,
} from "./platform/_lib/supabase-admin";
import type { RiskAction, TransactionStatus } from "./platform/_lib/types";

interface TransactionBody {
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  providerOrderId?: string | null;
  quoteToken?: string;
}

function statusForRisk(action: RiskAction): TransactionStatus {
  if (action === "hold" || action === "freeze") {
    return "held";
  }
  if (action === "reject") {
    return "failed";
  }
  return "created";
}

function merchantApiKey(request: any): string | null {
  const raw = request.headers?.["x-merchant-api-key"] ?? request.headers?.["X-Merchant-Api-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getPlatformConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    await rateLimitPlatform(request, session.privyUserId);

    const user = await getPlatformUserByPrivyUserId(config, session.privyUserId);
    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "Open the app first to initialize your profile");
    }

    // A merchant is resolved from its own API key, never from the body. The
    // body used to carry merchantId, so any authenticated user could attribute
    // a transaction to any merchant.
    const apiKey = merchantApiKey(request);
    const merchant = apiKey ? await getMerchantByApiKey(config, apiKey) : null;
    if (apiKey && !merchant) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid merchant API key");
    }

    const body = parseJsonBody<TransactionBody>(request);
    const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");

    if (!config.quoteSigningSecret) {
      throw new HttpError(500, "QUOTES_MISCONFIGURED", "Missing quote signing secret");
    }

    // Every amount comes from the signed quote. Nothing in the request body
    // can change what gets booked.
    const claims = verifyQuoteToken(
      requireString(body.quoteToken, "quoteToken"),
      config.quoteSigningSecret,
    );
    if (claims.ownerId !== user.id) {
      throw new HttpError(403, "QUOTE_OWNER_MISMATCH", "This quote belongs to another account");
    }

    if (claims.risk.action === "reject") {
      throw new HttpError(422, "RISK_REJECTED", "This transaction cannot be processed");
    }

    const transaction = await createPlatformTransaction(config, {
      country: claims.country,
      cryptoAmount: claims.cryptoAmount,
      cryptoAsset: claims.cryptoAsset,
      direction: claims.direction,
      feeAmount: claims.feeAmount,
      fiatCurrency: claims.fiatCurrency,
      grossAmount: claims.amount,
      idempotencyKey,
      merchantId: merchant?.id ?? null,
      metadata: body.metadata ?? {},
      paymentMethod: claims.paymentMethod,
      provider: claims.provider,
      providerOrderId: optionalString(body.providerOrderId),
      railId: claims.railId,
      riskAction: claims.risk.action,
      riskCaseRequired: claims.risk.caseRequired,
      riskReasonCode: claims.risk.reasonCode,
      riskScore: claims.risk.score,
      status: statusForRisk(claims.risk.action),
      userId: user.id,
    });

    json(response, 200, {
      success: true,
      data: { transaction },
    });
  });
}
