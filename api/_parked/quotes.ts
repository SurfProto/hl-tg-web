import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getPlatformConfig, isProhibitedCorridor } from "../platform/_lib/config";
import { rateLimitPlatform } from "../platform/_lib/rate-limit";
import {
  requireDirection,
  requirePaymentMethod,
  requirePositiveNumber,
  requireString,
} from "../platform/_lib/request";
import { QUOTE_TTL_SECONDS, signQuoteToken } from "../platform/_lib/quote-token";
import { deriveRiskFlags } from "../platform/_lib/risk-derivation";
import { evaluateRiskDecision } from "../platform/_lib/risk";
import { routeQuote } from "../platform/_lib/rails";
import {
  getPaymentRails,
  getPlatformUserByPrivyUserId,
  getReferenceRate,
  getUserRiskProfile,
  getUserVelocity,
} from "../platform/_lib/supabase-admin";

interface QuoteBody {
  amount?: number | string;
  country?: string;
  cryptoAsset?: string;
  currency?: string;
  direction?: string;
  paymentMethod?: string;
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

    const body = parseJsonBody<QuoteBody>(request);
    const amount = requirePositiveNumber(body.amount, "amount");
    const country = requireString(body.country, "country").toUpperCase();
    const currency = requireString(body.currency, "currency").toUpperCase();
    const cryptoAsset = requireString(body.cryptoAsset, "cryptoAsset").toUpperCase();
    const direction = requireDirection(body.direction);
    const paymentMethod = requirePaymentMethod(body.paymentMethod);

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

    // Price the crypto leg here rather than trusting the caller. Without a
    // reference rate we refuse instead of guessing.
    const rate = await getReferenceRate(config, currency, cryptoAsset);
    if (!rate) {
      throw new HttpError(
        422,
        "NO_REFERENCE_RATE",
        `No reference rate is configured for ${currency}/${cryptoAsset}`,
      );
    }
    const cryptoAmount = Number((quote.netAmount * rate.rate).toFixed(8));

    // Risk flags come from the stored screening record, the user's own
    // history, and server configuration — never from the request body.
    const [profile, velocity] = await Promise.all([
      getUserRiskProfile(config, user.id),
      getUserVelocity(config, user.id),
    ]);
    const risk = evaluateRiskDecision({
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

    if (!config.quoteSigningSecret) {
      throw new HttpError(500, "QUOTES_MISCONFIGURED", "Missing quote signing secret");
    }

    const expiresAt = Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS;
    const quoteToken = signQuoteToken(
      {
        amount,
        country,
        cryptoAmount,
        cryptoAsset,
        direction,
        expiresAt,
        feeAmount: quote.totalFee,
        fiatCurrency: currency,
        ownerId: user.id,
        paymentMethod,
        provider: quote.provider,
        railId: quote.railId,
        risk,
      },
      config.quoteSigningSecret,
    );

    json(response, 200, {
      success: true,
      data: {
        quote: { ...quote, cryptoAmount, cryptoAsset, rate: rate.rate },
        quoteToken,
        expiresAt,
        risk,
      },
    });
  });
}
