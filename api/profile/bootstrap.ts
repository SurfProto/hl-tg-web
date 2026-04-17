import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, json, parseJsonBody, withJsonRoute } from "../onramp/_lib/http";
import { getProfileConfig } from "./_lib/config";
import { bootstrapProfileUser, getNotificationPreferences } from "./_lib/supabase-admin";

interface BootstrapProfileBody {
  telegramId?: string | null;
  walletAddress?: string | null;
  username?: string | null;
  email?: string | null;
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

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getProfileConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const body = parseJsonBody<BootstrapProfileBody>(request);
    const profile = await bootstrapProfileUser(config, {
      privyUserId: session.privyUserId,
      telegramId: body.telegramId?.trim() ?? null,
      walletAddress: body.walletAddress?.trim() ?? null,
      username: body.username?.trim() ?? null,
      email: body.email?.trim().toLowerCase() ?? null,
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
