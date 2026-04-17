import { requirePrivySession } from "./onramp/_lib/auth";
import {
  HttpError,
  json,
  parseJsonBody,
  withJsonRoute,
} from "./onramp/_lib/http";
import { getProfileConfig } from "./profile/_lib/config";
import {
  getNotificationChannelStatus,
  getNotificationPreferences,
  getProfileByPrivyUserId,
  updateProfileUser,
} from "./profile/_lib/supabase-admin";

interface UpdateProfileBody {
  username?: string | null;
  language?: string | null;
}

function mapProfile(profile: NonNullable<Awaited<ReturnType<typeof getProfileByPrivyUserId>>>) {
  return {
    id: profile.id,
    telegramId: profile.telegram_id,
    walletAddress: profile.wallet_address,
    privyUserId: profile.privy_user_id,
    username: profile.username,
    email: profile.email,
    language: profile.language ?? "en",
  };
}

function mapNotificationPreferences(
  prefs: Awaited<ReturnType<typeof getNotificationPreferences>>,
) {
  return {
    liquidationAlerts: prefs.liquidation_alerts,
    orderFills: prefs.order_fills,
    usdcDeposits: prefs.usdc_deposits,
  };
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);

    if (request.method === "GET") {
      const profile = await getProfileByPrivyUserId(config, session.privyUserId);
      if (!profile) {
        throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found");
      }

      const prefs = await getNotificationPreferences(config, profile.id);
      const telegramDeliveryStatus = await getNotificationChannelStatus(
        config,
        profile.id,
      );
      json(response, 200, {
        success: true,
        data: {
          profile: mapProfile(profile),
          notificationPreferences: mapNotificationPreferences(prefs),
          telegramDeliveryStatus,
        },
      });
      return;
    }

    if (request.method === "PATCH") {
      const body = parseJsonBody<UpdateProfileBody>(request);
      const username =
        typeof body.username === "string" ? body.username.trim() || null : undefined;
      const language =
        typeof body.language === "string" ? body.language.trim() || null : undefined;

      if (typeof username === "undefined" && typeof language === "undefined") {
        throw new HttpError(400, "INVALID_PROFILE_UPDATE", "No editable profile fields were provided");
      }

      const profile = await updateProfileUser(config, session.privyUserId, {
        ...(typeof username !== "undefined" ? { username } : {}),
        ...(typeof language !== "undefined" ? { language } : {}),
      });

      json(response, 200, {
        success: true,
        data: {
          profile: mapProfile(profile),
        },
      });
      return;
    }

    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Expected GET or PATCH");
  });
}
