import { ensureMethod, HttpError, json, withJsonRoute } from "./onramp/_lib/http";
import { getStringQuery } from "./onramp/_lib/request";
import { getPlatformConfig } from "./platform/_lib/config";
import { listSettlements } from "./platform/_lib/supabase-admin";

function requireAdminKey(request: any, expected: string | null) {
  const actual = request.headers["x-platform-admin-key"] ?? request.headers["X-Platform-Admin-Key"];
  if (!expected || actual !== expected) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid platform admin key");
  }
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "GET");

    const config = getPlatformConfig();
    requireAdminKey(request, config.platformAdminKey);

    const merchantId = getStringQuery(request, "merchant_id");
    const settlements = await listSettlements(config, merchantId);

    json(response, 200, {
      success: true,
      data: { settlements },
    });
  });
}
