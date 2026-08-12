import { ensureMethod, json, withJsonRoute } from "../onramp/_lib/http";
import { getStringQuery } from "../onramp/_lib/request";
import { requirePlatformAdminKey } from "../platform/_lib/admin-auth";
import { getPlatformConfig } from "../platform/_lib/config";
import { listSettlements } from "../platform/_lib/supabase-admin";

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "GET");

    const config = getPlatformConfig();
    requirePlatformAdminKey(request, config.platformAdminKey);

    const merchantId = getStringQuery(request, "merchant_id");
    const settlements = await listSettlements(config, merchantId);

    json(response, 200, {
      success: true,
      data: { settlements },
    });
  });
}
