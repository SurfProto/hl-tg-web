import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig } from "./_lib/config";
import { syncRewardsDashboard } from "./_lib/program";

interface DashboardBody {
  startParam?: string | null;
  username?: string | null;
  walletAddress?: string | null;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getRewardsConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const body = parseJsonBody<DashboardBody>(request);
    const dashboard = await syncRewardsDashboard(
      {
        privyUserId: session.privyUserId,
        referralStartParam: body.startParam ?? null,
        username: body.username ?? null,
        walletAddress: body.walletAddress ?? null,
      },
      config,
    );

    json(response, 200, {
      success: true,
      data: dashboard,
    });
  });
}
