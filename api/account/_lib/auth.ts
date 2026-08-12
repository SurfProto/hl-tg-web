import { requirePrivySession } from "../../onramp/_lib/auth";
import { getProfileConfig } from "../../profile/_lib/config";
import { getProfileByPrivyUserId } from "../../profile/_lib/supabase-admin";
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

  const profile = await getProfileByPrivyUserId(config, session.privyUserId);
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
