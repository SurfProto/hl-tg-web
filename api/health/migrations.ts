import { constantTimeEquals } from "../_lib/secret-compare";
import { buildHeaders, supabaseRequest } from "../_lib/supabase";
import { HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "../profile/_lib/config";

/**
 * Which migrations are actually applied to the live database, answerable from
 * the repository at last: one marker object per migration, checked by
 * rpc/migrations_report (026). Until this existed, "is prod missing a
 * migration?" was a prose audit in HANDOFF.md — and the price-alerts launch
 * shipped code whose migration had to be applied on trust.
 *
 * Admin-keyed like the notifications status report: schema drift is operator
 * information, not public surface.
 */

// The parked payments layer. Deliberately unapplied; their absence is not
// drift. See DEPLOYMENT.md.
const EXPECTED_UNAPPLIED = new Set([
  "004_platform_orchestration",
  "005_platform_hardening",
]);

interface MigrationMarkerRow {
  migration: string;
  marker: string;
  present: boolean;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }

    const adminKey = process.env.REWARDS_ADMIN_KEY ?? null;
    const provided =
      request.headers?.["x-rewards-admin-key"] ??
      request.headers?.["X-REWARDS-ADMIN-KEY"];
    if (!adminKey || !constantTimeEquals(provided, adminKey)) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid admin key");
    }

    const config = getProfileConfig();
    const rows = await supabaseRequest<MigrationMarkerRow[]>(
      config,
      "rpc/migrations_report",
      {
        body: JSON.stringify({}),
        headers: buildHeaders(config),
        method: "POST",
      },
    );

    const missing = rows
      .filter((row) => !row.present && !EXPECTED_UNAPPLIED.has(row.migration))
      .map((row) => row.migration);

    json(response, 200, {
      success: true,
      data: {
        ok: missing.length === 0,
        missing,
        expectedUnapplied: [...EXPECTED_UNAPPLIED],
        migrations: rows,
      },
    });
  });
}
