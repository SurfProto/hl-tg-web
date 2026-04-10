import { requirePrivySession } from "./_lib/auth";
import { getOnrampConfig } from "./_lib/config";
import { ensureMethod, json, parseJsonBody, withJsonRoute, HttpError } from "./_lib/http";
import { assertAmountWithinOnrampLimits, precalcOnramp } from "./_lib/provider";
import { toQuoteResponse } from "./_lib/responses";
import { parseAmount } from "./_lib/request";
import { getUserByPrivyUserId } from "./_lib/supabase-admin";

interface QuoteBody {
  amount?: number | string;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getOnrampConfig();
    const session = requirePrivySession(request, config.privyAppId);
    const user = await getUserByPrivyUserId(config, session.privyUserId);
    if (!user?.email) {
      throw new HttpError(400, "EMAIL_REQUIRED", "A linked email is required before requesting a quote");
    }

    const body = parseJsonBody<QuoteBody>(request);
    const amount = parseAmount(body.amount);
    await assertAmountWithinOnrampLimits(config, amount);
    const quote = await precalcOnramp(config, amount);

    json(response, 200, {
      success: true,
      data: {
        state: "quote_ready",
        quote: toQuoteResponse(config, quote),
      },
    });
  });
}
