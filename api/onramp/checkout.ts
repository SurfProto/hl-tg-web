import { requirePrivySession } from "./_lib/auth";
import { createAndPersistOrder } from "./_lib/checkout";
import { getOnrampConfig } from "./_lib/config";
import { ensureMethod, json, parseJsonBody, withJsonRoute, HttpError } from "./_lib/http";
import { assertAmountWithinOnrampLimits } from "./_lib/provider";
import { parseAmount } from "./_lib/request";
import { getUserByPrivyUserId } from "./_lib/supabase-admin";

interface CheckoutBody {
  amount?: number | string;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getOnrampConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const user = await getUserByPrivyUserId(config, session.privyUserId);
    if (!user?.email) {
      throw new HttpError(400, "EMAIL_REQUIRED", "A linked email is required before starting onramp");
    }
    if (!user.wallet_address) {
      throw new HttpError(400, "WALLET_REQUIRED", "A connected wallet is required before starting onramp");
    }

    const body = parseJsonBody<CheckoutBody>(request);
    const amount = parseAmount(body.amount);
    await assertAmountWithinOnrampLimits(config, amount);
    const order = await createAndPersistOrder({
      config,
      user: {
        id: user.id,
        walletAddress: user.wallet_address,
        email: user.email,
        kycId: user.kyc_id,
      },
      amount,
    });

    json(response, 200, {
      success: true,
      data: {
        state: order.appState,
        order,
      },
    });
  });
}
