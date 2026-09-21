import { requirePrivySession } from "../../onramp/_lib/auth";
import { getProfileConfig } from "../../profile/_lib/config";
import { getProfileByPrivyUserId } from "../../profile/_lib/supabase-admin";
import { isSupabaseUnavailable } from "../../_lib/supabase";
import { noteSupabaseUnavailable } from "../../_lib/supabase-telemetry";
import { HttpError } from "../../market/_lib/response";
import { requireTelegramInitData } from "./telegram";
import { rateLimitAccount } from "./rate-limit";
import { getDevAccountContext } from "./dev-bypass";

export interface AccountContext {
  privyUserId: string;
  telegramUserId: string | null;
  walletAddress: string;
}

export async function requireAccountContext(request: any): Promise<AccountContext> {
  // Local development only — see ./dev-bypass.ts. Inert unless NODE_ENV is not
  // "production" *and* DEV_ACCOUNT_WALLET is set, so it cannot be enabled on
  // Vercel (Preview included, since Vercel sets NODE_ENV=production there too).
  const devContext = getDevAccountContext();
  if (devContext) {
    return devContext;
  }

  const config = getProfileConfig();
  const session = await requirePrivySession(request, config.privyAppId);
  const telegram = requireTelegramInitData(request);
  await rateLimitAccount(request, session.privyUserId);

  let profile: Awaited<ReturnType<typeof getProfileByPrivyUserId>>;
  try {
    profile = await getProfileByPrivyUserId(config, session.privyUserId);
  } catch (error) {
    // The lookup failed because Supabase did not answer, not because of this
    // request. Say so. As an unhandled error this became 500 INTERNAL_ERROR —
    // the shape every code defect produces — which is why the 2026-09-18
    // database outage was first read as an auth bug. 503 names the layer down.
    if (isSupabaseUnavailable(error)) {
      // The compact line the runtime log needs: an HttpError is rendered
      // without logging, and a user with no stale copy would otherwise leave
      // no trace at all during an outage.
      noteSupabaseUnavailable("account-auth", error);
      throw new HttpError(
        503,
        "PROFILE_LOOKUP_UNAVAILABLE",
        "Account lookup is temporarily unavailable",
      );
    }
    throw error;
  }
  const walletAddress = profile?.wallet_address?.trim();
  if (!walletAddress) {
    throw new HttpError(404, "PROFILE_WALLET_NOT_FOUND", "No wallet profile is linked to this account");
  }

  // The init data signature was verified, but the result used to be discarded,
  // so any valid init data from any user of the bot satisfied the check. Bind it
  // to the profile: the Telegram account presenting the request must be the one
  // linked to the Privy account the token belongs to.
  const telegramUserId = telegram.user?.id;
  const boundTelegramId = profile?.telegram_id?.trim();
  if (boundTelegramId && telegramUserId != null && String(telegramUserId) !== boundTelegramId) {
    throw new HttpError(
      403,
      "TELEGRAM_IDENTITY_MISMATCH",
      "This Telegram account is not linked to the signed-in profile",
    );
  }

  return {
    privyUserId: session.privyUserId,
    telegramUserId: telegramUserId != null ? String(telegramUserId) : null,
    walletAddress,
  };
}
