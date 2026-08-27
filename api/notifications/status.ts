import { constantTimeEquals } from "../_lib/secret-compare";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "../profile/_lib/config";
import { getNotificationsStatus } from "./_lib/supabase-admin";

/**
 * Is the notification pipeline working, or is it merely quiet?
 *
 * Those two states were indistinguishable from outside, and the difference
 * matters: a healthy pipeline with nothing to report and a dead one both
 * produce zero notifications. The worker was reported dead when in fact it was
 * running every minute with an up-to-date cursor and no new trades to announce.
 *
 * Read-only, by a verb that cannot write. Admin-key authenticated, because the
 * report aggregates across every account.
 */
export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "GET");

    const adminKey = process.env.REWARDS_ADMIN_KEY ?? null;
    const provided =
      request.headers?.["x-rewards-admin-key"] ?? request.headers?.["X-REWARDS-ADMIN-KEY"];

    if (!adminKey || !constantTimeEquals(provided, adminKey)) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid admin key");
    }

    const config = getProfileConfig();
    const report = await getNotificationsStatus(config);

    // Stated rather than left to be inferred from the numbers. "Zero events" is
    // the normal state of a healthy pipeline, so a reader needs to be told which
    // signal actually indicates trouble.
    const verdict = report.workerStale
      ? "worker_stale"
      : report.channelsFailing > 0 || report.eventsFailed > 0
        ? "delivery_degraded"
        : "healthy";

    json(response, 200, {
      success: true,
      data: {
        report,
        verdict,
      },
    });
  });
}
