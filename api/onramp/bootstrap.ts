import { requirePrivySession } from "./_lib/auth";
import { buildBootstrapState } from "./_lib/bootstrap";
import { getOnrampConfig } from "./_lib/config";
import { ensureMethod, json, parseJsonBody, withJsonRoute } from "./_lib/http";
import { getActiveOrder, hasVerifiedEmail, upsertOnrampUser } from "./_lib/supabase-admin";

interface BootstrapBody {
  email?: string | null;
  walletAddress?: string | null;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getOnrampConfig();
    const session = requirePrivySession(request, config.privyAppId);
    const body = parseJsonBody<BootstrapBody>(request);
    const email = body.email?.trim().toLowerCase() ?? null;
    const walletAddress = body.walletAddress?.trim() ?? null;
    const hasVerifiedEmailMatch = await hasVerifiedEmail(config, email);
    const kycStatus = !email ? "email_missing" : hasVerifiedEmailMatch ? "verified_local" : "unknown";
    const kycSource = !email ? null : hasVerifiedEmailMatch ? "verified_emails" : "deferred_v1";
    const user = await upsertOnrampUser(config, {
      privyUserId: session.privyUserId,
      walletAddress,
      email,
      kycStatus,
      kycSource,
      kycCheckedAt: new Date().toISOString(),
    });
    const activeOrder = await getActiveOrder(config, user.id);

    // TODO: Enforce provider KYC status and hosted KYC redirect here in the next phase.
    const bootstrap = buildBootstrapState({
      email: user.email,
      walletAddress: user.wallet_address,
      hasVerifiedEmailMatch,
      activeOrder,
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
