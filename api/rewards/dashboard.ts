import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, json, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig } from "./_lib/config";
import { getRewardsDashboard } from "./_lib/program";

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getRewardsConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    // startParam is deliberately not read. A referral is applied by the
    // explicit mutation at /api/rewards/referral/apply, before this is called:
    // linking an account as a side effect of a page load made the outcome
    // depend on which request won, and made a GET-shaped call a mutation.
    const dashboard = await getRewardsDashboard(
      { privyUserId: session.privyUserId },
      config,
    );

    json(response, 200, {
      success: true,
      data: dashboard,
    });
  });
}
