import { requirePrivySession } from "../../onramp/_lib/auth";
import { ensureMethod, json, parseJsonBody, withJsonRoute } from "../../onramp/_lib/http";
import { getRewardsConfig } from "../_lib/config";
import { applyReferralCode } from "../_lib/program";

interface ApplyReferralBody {
  referralCode?: string | null;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getRewardsConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const body = parseJsonBody<ApplyReferralBody>(request);
    const referral = await applyReferralCode(
      session.privyUserId,
      body.referralCode ?? "",
      config,
    );

    json(response, 200, {
      success: true,
      data: referral,
    });
  });
}
