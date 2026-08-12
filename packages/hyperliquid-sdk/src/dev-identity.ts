/**
 * Local-only stand-in for a signed-in Privy account.
 *
 * The app's only login trigger is `loginWithTelegram()`, and it fires only when
 * `window.Telegram.WebApp.initData` is present. Outside Telegram that is empty,
 * so nothing ever calls login, `user?.id` stays null, and every account-scoped
 * query stays disabled — portfolio, positions and the trade flow were all
 * unreachable locally even with the server-side bypass in place.
 *
 * Safety rests on `import.meta.env.DEV`, which Vite replaces with the literal
 * `false` in a production build. The branches below are therefore removed by
 * dead-code elimination rather than merely skipped at runtime, so this cannot be
 * switched on in a deployment by setting an environment variable.
 *
 * Pairs with api/account/_lib/dev-bypass.ts, which serves the matching wallet
 * server-side. Both must be configured for local account data to appear.
 */

/** Placeholder bearer token. The dev bypass ignores its value. */
export const DEV_ACCESS_TOKEN = "dev-local-access-token";

const DEV_SCOPE_PREFIX = "dev-local";

export function isDevIdentityEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  return Boolean(import.meta.env.VITE_DEV_ACCOUNT_WALLET);
}

/**
 * Query-cache scope for the synthetic account. Includes the wallet so switching
 * DEV_ACCOUNT_WALLET does not read the previous address's cached entries.
 */
export function getDevAccountScope(): string | null {
  if (!isDevIdentityEnabled()) return null;
  return `${DEV_SCOPE_PREFIX}:${import.meta.env.VITE_DEV_ACCOUNT_WALLET}`;
}

export function getDevWalletAddress(): string | null {
  if (!isDevIdentityEnabled()) return null;
  return (import.meta.env.VITE_DEV_ACCOUNT_WALLET as string) ?? null;
}
