import { describe, expect, it } from "vitest";

import { getDevAccountContext } from "./dev-bypass";

/**
 * This bypass returns an authenticated account context without a Privy token,
 * Telegram init data or a Supabase profile. The only thing standing between it
 * and an auth bypass in a deployed environment is the gating, so the gating is
 * what these tests pin down.
 */
describe("getDevAccountContext", () => {
  const wallet = "0x1111111111111111111111111111111111111111";

  it("is inert when NODE_ENV is production, even with the variable set", () => {
    expect(
      getDevAccountContext({ NODE_ENV: "production", DEV_ACCOUNT_WALLET: wallet }),
    ).toBeNull();
  });

  it("is inert when the wallet variable is absent", () => {
    expect(getDevAccountContext({ NODE_ENV: "development" })).toBeNull();
    expect(getDevAccountContext({})).toBeNull();
  });

  it("is inert when the wallet variable is blank or whitespace", () => {
    expect(getDevAccountContext({ NODE_ENV: "development", DEV_ACCOUNT_WALLET: "" })).toBeNull();
    expect(
      getDevAccountContext({ NODE_ENV: "development", DEV_ACCOUNT_WALLET: "   " }),
    ).toBeNull();
  });

  it("activates only when both conditions hold", () => {
    expect(getDevAccountContext({ NODE_ENV: "development", DEV_ACCOUNT_WALLET: wallet })).toEqual({
      privyUserId: "did:privy:local-dev",
      telegramUserId: null,
      walletAddress: wallet,
    });
  });

  it("carries through an explicit privy and telegram identity", () => {
    expect(
      getDevAccountContext({
        NODE_ENV: "test",
        DEV_ACCOUNT_WALLET: wallet,
        DEV_ACCOUNT_PRIVY_USER_ID: "did:privy:abc",
        DEV_ACCOUNT_TELEGRAM_USER_ID: "12345",
      }),
    ).toEqual({
      privyUserId: "did:privy:abc",
      telegramUserId: "12345",
      walletAddress: wallet,
    });
  });

  // Vercel sets NODE_ENV=production on Preview deployments too, so a bypass
  // that only checked for a non-production-looking branch name would be live on
  // every preview URL. Checking NODE_ENV is what makes it local-only.
  it("stays inert on a Vercel preview, which reports NODE_ENV=production", () => {
    expect(
      getDevAccountContext({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        DEV_ACCOUNT_WALLET: wallet,
      }),
    ).toBeNull();
  });
});
