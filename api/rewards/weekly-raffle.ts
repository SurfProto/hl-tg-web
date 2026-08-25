import { constantTimeEquals } from "../_lib/secret-compare";
import { ensureMethod, HttpError, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig } from "./_lib/config";

/**
 * Disabled while the rewards program is XP-only.
 *
 * Authorization is still checked first, and checked exactly as it was: an
 * unauthenticated caller must not be able to discover whether the route is
 * disabled, and an operator who does hold the admin key deserves the specific
 * REWARDS_XP_ONLY answer rather than a 401 that sends them looking for a
 * credential problem.
 *
 * The refusal happens here, before any work. This module deliberately does not
 * import `_lib/raffle`, so no run can be claimed, no cohort ranked, no winner
 * drawn, no ledger row written and no USDC sent — not as a matter of an early
 * return that could be moved, but because the code that would do it is not in
 * this module graph. The route also remains absent from vercel.json's crons.
 */
export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    const config = getRewardsConfig();
    if (request.method === "GET") {
      const cronSecret = process.env.CRON_SECRET;
      const authorization = request.headers?.authorization ?? request.headers?.Authorization;
      if (!cronSecret || !constantTimeEquals(authorization, `Bearer ${cronSecret}`)) {
        throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid cron authorization");
      }
    } else {
      ensureMethod(request, "POST");

      const adminKey = request.headers["x-rewards-admin-key"] ?? request.headers["X-REWARDS-ADMIN-KEY"];
      if (!config.rewardsAdminKey || !constantTimeEquals(adminKey, config.rewardsAdminKey)) {
        throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid rewards admin key");
      }
    }

    throw new HttpError(
      409,
      "REWARDS_XP_ONLY",
      "The weekly raffle is paused while the rewards program is XP-only.",
    );
  });
}
