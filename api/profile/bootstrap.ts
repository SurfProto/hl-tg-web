import { requirePrivySession } from "../onramp/_lib/auth";
import { requireTelegramInitData } from "../account/_lib/telegram";
import { ensureMethod, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "./_lib/config";
import { resolveAuthoritativeProfileIdentity } from "./_lib/identity";
import { bootstrapProfileUser, getNotificationPreferences } from "./_lib/supabase-admin";

interface BootstrapProfileBody {
  language?: string | null;
}

function mapProfile(profile: Awaited<ReturnType<typeof bootstrapProfileUser>>) {
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

function hasTelegramInitData(request: any) {
  const value =
    request.headers?.["x-telegram-init-data"] ??
    request.headers?.["X-Telegram-Init-Data"];
  return typeof value === "string" && value.trim().length > 0;
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const body = parseJsonBody<BootstrapProfileBody>(request);
    const identity = await resolveAuthoritativeProfileIdentity(config, session.privyUserId);
    const telegram = hasTelegramInitData(request) ? requireTelegramInitData(request) : null;
    const profile = await bootstrapProfileUser(config, {
      privyUserId: session.privyUserId,
      telegramId: telegram?.user?.id != null ? String(telegram.user.id) : null,
      walletAddress: identity.walletAddress,
      username: telegram?.user?.username?.trim() ?? null,
      email: identity.email,
      language: body.language?.trim() ?? null,
    });
    const prefs = await getNotificationPreferences(config, profile.id);

    json(response, 200, {
      success: true,
      data: {
        profile: mapProfile(profile),
        notificationPreferences: mapNotificationPreferences(prefs),
      },
    });
  });
}
