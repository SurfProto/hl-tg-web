import { requirePrivySession } from "./_lib/auth";
import { buildBootstrapState } from "./_lib/bootstrap";
import { getOnrampConfig } from "./_lib/config";
import { ensureMethod, HttpError, json, withJsonRoute } from "./_lib/http";
import { getActiveOrder, getRecentOrders, getUserByPrivyUserId, hasVerifiedEmail } from "./_lib/supabase-admin";

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getOnrampConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const user = await getUserByPrivyUserId(config, session.privyUserId);
    if (!user) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found");
    }
    const hasVerifiedEmailMatch = await hasVerifiedEmail(config, user.email);
    const activeOrder = await getActiveOrder(config, user.id);
    const recentOrders = await getRecentOrders(config, user.id, 5);

    // TODO: Enforce provider KYC status and hosted KYC redirect here in the next phase.
    const bootstrap = buildBootstrapState({
      email: user.email,
      walletAddress: user.wallet_address,
      hasVerifiedEmailMatch,
      storedKycId: user.kyc_id,
      storedKycStatus: user.kyc_status,
      activeOrder,
      recentOrders,
      limits: null,
    });

    json(response, 200, {
      success: true,
      data: {
        ...bootstrap,
        hasVerifiedEmailMatch,
        service: {
          serviceId: config.serviceId,
          symbol: config.appSymbol,
          network: config.network,
        },
      },
    });
  });
}
