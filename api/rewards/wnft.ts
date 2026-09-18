import { constantTimeEquals } from "../_lib/secret-compare";
import { getRewardsConfig } from "./_lib/config";
import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import {
  listWnftConversions,
  reviewWnftConversion,
  type WnftConversionRecord,
} from "./_lib/supabase-admin";

/**
 * The WNFT review surface. Admin-keyed, like the reconcile and status reports:
 * conversion records are operator data, and the review is a human decision.
 *
 *   GET  ?status=provisional   — the queue (or all, unfiltered)
 *   POST { userId, decision, reviewedBy, reason }
 *        — confirm or reject one provisional record, who and why recorded
 *
 * Nothing here moves money. Confirming a WNFT records that a human vouched for
 * a genuine conversion; the cash bounty is a separate, gated track that reads
 * these records but is not enabled by them.
 */

function requireAdmin(request: any, adminKey: string | null): void {
  const provided =
    request.headers?.["x-rewards-admin-key"] ??
    request.headers?.["X-REWARDS-ADMIN-KEY"];
  if (!adminKey || !constantTimeEquals(provided, adminKey)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid admin key");
  }
}

const VALID_STATUSES = new Set<WnftConversionRecord["status"]>([
  "provisional",
  "confirmed",
  "rejected",
]);

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    const config = getRewardsConfig();
    requireAdmin(request, config.rewardsAdminKey);

    if (request.method === "GET") {
      const rawStatus = request.query?.status;
      const status =
        typeof rawStatus === "string" && VALID_STATUSES.has(rawStatus as never)
          ? (rawStatus as WnftConversionRecord["status"])
          : undefined;
      const records = await listWnftConversions(config, status);
      json(response, 200, { success: true, data: { records } });
      return;
    }

    if (request.method === "POST") {
      const body = (request.body ?? {}) as {
        userId?: unknown;
        decision?: unknown;
        reviewedBy?: unknown;
        reason?: unknown;
      };

      const userId = typeof body.userId === "string" ? body.userId : "";
      const decision = body.decision;
      const reviewedBy =
        typeof body.reviewedBy === "string" ? body.reviewedBy.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";

      // A rejection without a reason is not an auditable decision — and a
      // confirmation is a person vouching, so it is held to the same bar.
      if (
        !userId ||
        (decision !== "confirmed" && decision !== "rejected") ||
        !reviewedBy ||
        !reason
      ) {
        throw new HttpError(
          400,
          "INVALID_REVIEW",
          "userId, decision (confirmed|rejected), reviewedBy and reason are all required",
        );
      }

      const record = await reviewWnftConversion(
        config,
        userId,
        decision,
        reviewedBy,
        reason,
      );
      if (!record) {
        // No provisional record for this user: already reviewed, or none.
        throw new HttpError(
          409,
          "NOT_PROVISIONAL",
          "No provisional WNFT record for this user",
        );
      }

      json(response, 200, { success: true, data: { record } });
      return;
    }

    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET or POST");
  });
}
