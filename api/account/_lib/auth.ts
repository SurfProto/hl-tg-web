import { requirePrivySession } from "../../onramp/_lib/auth";
import { getProfileConfig } from "../../profile/_lib/config";
import { getProfileByPrivyUserId } from "../../profile/_lib/supabase-admin";
import { HttpError } from "../../market/_lib/response";
import { requireTelegramInitData } from "./telegram";
import { rateLimitAccount } from "./rate-limit";

export interface AccountContext {
  privyUserId: string;
  walletAddress: string;
}

export async function requireAccountContext(request: any): Promise<AccountContext> {
  const config = getProfileConfig();
  const session = await requirePrivySession(request, config.privyAppId);
  requireTelegramInitData(request);
  await rateLimitAccount(request, session.privyUserId);

  const profile = await getProfileByPrivyUserId(config, session.privyUserId);
  const walletAddress = profile?.wallet_address?.trim();
  if (!walletAddress) {
    throw new HttpError(404, "PROFILE_WALLET_NOT_FOUND", "No wallet profile is linked to this account");
  }

  return {
    privyUserId: session.privyUserId,
    walletAddress,
  };
}
