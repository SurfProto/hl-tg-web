import { constantTimeEquals } from "../_lib/secret-compare";
import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig } from "./_lib/config";
import {
  getActiveSeason,
  getReconciliationReport,
  getXpProjectionDrift,
  rebuildXpProjection,
} from "./_lib/supabase-admin";

/**
 * Reconciliation for the rewards program.
 *
 * `GET` reports; `POST` repairs. That split is the whole design, not a REST
 * convention: a reconciliation tool that mutates by default cannot be used to
 * answer "is anything wrong?", because running it destroys the evidence of what
 * was wrong. Reporting is therefore reachable only through a verb that cannot
 * write, rather than through a flag somebody has to remember to pass.
 *
 * Repair is deliberately narrow. `rebuild_xp_projection` recomputes
 * `user_points.xp` from the ledger and touches nothing else — not
 * `total_volume`, which comes from exchange fills and would be zeroed by a
 * rebuild that assumed the ledger knew everything.
 *
 * Admin-key authenticated, like the other operator routes. The report names
 * internal user ids and every account's XP, so it is not something to expose
 * behind an ordinary user session.
 */

/** Repairs this route is willing to perform, named explicitly. */
const REPAIR_ACTIONS = ["rebuild_xp_projection"] as const;

type RepairAction = (typeof REPAIR_ACTIONS)[number];

interface ReconcileBody {
  action?: string;
  /** Cap on drift rows returned with a report. */
  driftLimit?: number;
}

function requireAdmin(request: any, adminKey: string | null) {
  const provided =
    request.headers?.["x-rewards-admin-key"] ?? request.headers?.["X-REWARDS-ADMIN-KEY"];

  if (!adminKey || !constantTimeEquals(provided, adminKey)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid rewards admin key");
  }
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    const config = getRewardsConfig();
    requireAdmin(request, config.rewardsAdminKey);

    // Never creates one. Reconciliation reports on what exists; inventing a
    // season in order to have something to report on would be absurd.
    const season = await getActiveSeason(config);
    if (!season) {
      throw new HttpError(409, "NO_ACTIVE_SEASON", "There is no active season to reconcile");
    }

    if (request.method === "GET") {
      const [report, drift] = await Promise.all([
        getReconciliationReport(config, season.id),
        getXpProjectionDrift(config, season.id),
      ]);

      json(response, 200, {
        success: true,
        data: {
          // Present even when zero, so an operator can tell "checked, nothing
          // wrong" apart from "did not check".
          drift: drift.slice(0, 100),
          report,
          season: { id: season.id, name: season.name },
        },
      });
      return;
    }

    ensureMethod(request, "POST");

    const body = parseJsonBody<ReconcileBody>(request);
    const action = body.action;

    if (!action || !REPAIR_ACTIONS.includes(action as RepairAction)) {
      throw new HttpError(
        400,
        "UNKNOWN_REPAIR_ACTION",
        `action must be one of: ${REPAIR_ACTIONS.join(", ")}`,
      );
    }

    // Snapshot the disagreement before repairing it. Without this the response
    // could only say how many rows changed, which is not enough to review
    // afterwards whether the repair was the right thing to have done.
    const before = await getXpProjectionDrift(config, season.id);
    const updated = await rebuildXpProjection(config, season.id);
    const after = await getXpProjectionDrift(config, season.id);

    console.info(
      `[rewards-reconcile] rebuild_xp_projection season=${season.id} ` +
        `driftBefore=${before.length} rowsUpdated=${updated} driftAfter=${after.length}`,
    );

    json(response, 200, {
      success: true,
      data: {
        action,
        driftAfter: after,
        driftBefore: before,
        rowsUpdated: updated,
        season: { id: season.id, name: season.name },
      },
    });
  });
}
