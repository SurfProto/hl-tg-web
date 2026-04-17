import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, HttpError, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "./_lib/config";
import { upsertNotificationPreferences } from "./_lib/supabase-admin";

interface NotificationPreferencesBody {
  liquidationAlerts?: boolean;
  orderFills?: boolean;
  usdcDeposits?: boolean;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "PATCH");

    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const body = parseJsonBody<NotificationPreferencesBody>(request);

    if (
      typeof body.liquidationAlerts !== "boolean" ||
      typeof body.orderFills !== "boolean" ||
      typeof body.usdcDeposits !== "boolean"
    ) {
      throw new HttpError(
        400,
        "INVALID_NOTIFICATION_PREFERENCES",
        "Notification preferences must all be booleans",
      );
    }

    const prefs = await upsertNotificationPreferences(config, session.privyUserId, {
      liquidationAlerts: body.liquidationAlerts,
      orderFills: body.orderFills,
      usdcDeposits: body.usdcDeposits,
    });

    json(response, 200, {
      success: true,
      data: {
        notificationPreferences: {
          liquidationAlerts: prefs.liquidation_alerts,
          orderFills: prefs.order_fills,
          usdcDeposits: prefs.usdc_deposits,
        },
      },
    });
  });
}
