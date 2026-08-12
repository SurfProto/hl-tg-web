import type { AccountContext } from "./auth";

/**
 * Local-only escape hatch for the account routes.
 *
 * `requireAccountContext` needs a Privy access token, signed Telegram init data
 * and a Supabase profile row. None of those can be produced on a developer's
 * machine — there is no Telegram WebApp context outside Telegram — so the
 * /api/account/* routes were unreachable locally and the app could not be
 * exercised end to end.
 *
 * Modelled on the existing preview bypass in ./telegram.ts. Two independent
 * conditions must both hold, so it cannot be switched on by an environment
 * variable alone:
 *
 *   1. NODE_ENV must not be "production"
 *   2. DEV_ACCOUNT_WALLET must be explicitly set
 *
 * Vercel sets NODE_ENV=production on Preview deployments as well as Production,
 * so condition 1 makes this genuinely local-only. That is the intended
 * behaviour, not a limitation: a bypass that worked on Preview URLs would be
 * reachable by anyone holding the URL.
 */

export const DEV_WALLET_ENV = "DEV_ACCOUNT_WALLET";
export const DEV_PRIVY_USER_ENV = "DEV_ACCOUNT_PRIVY_USER_ID";
export const DEV_TELEGRAM_USER_ENV = "DEV_ACCOUNT_TELEGRAM_USER_ID";

export function getDevAccountContext(
  env: Record<string, string | undefined> = process.env,
): AccountContext | null {
  if (env.NODE_ENV === "production") {
    return null;
  }

  const walletAddress = env[DEV_WALLET_ENV]?.trim();
  if (!walletAddress) {
    return null;
  }

  return {
    privyUserId: env[DEV_PRIVY_USER_ENV]?.trim() || "did:privy:local-dev",
    telegramUserId: env[DEV_TELEGRAM_USER_ENV]?.trim() || null,
    walletAddress,
  };
}
