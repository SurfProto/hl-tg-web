import { describe, expect, it, vi } from "vitest";

import { getUserByPrivyUserId } from "./supabase-admin";
import type { OnrampConfig } from "./config";

const config: OnrampConfig = {
  baseUrl: "https://provider.example",
  proxyToken: "proxy_token_123",
  serviceId: "svc_123",
  appSymbol: "RUB-USDT",
  providerSymbol: "RUB-USDT",
  network: "TRC20",
  returnUrl: null,
  privyAppId: "privy_app_123",
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "service_role_123",
};

describe("supabaseRequest", () => {
  it("throws a source-specific error when Supabase returns HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Access denied</body></html>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
        },
      }),
    );

    await expect(getUserByPrivyUserId(config, "did:privy:user_123")).rejects.toThrow(
      "Supabase returned HTML for users?privy_user_id=eq.did%3Aprivy%3Auser_123&select=*",
    );
  });

  it("throws a source-specific error when Supabase returns invalid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await expect(getUserByPrivyUserId(config, "did:privy:user_123")).rejects.toThrow(
      "Supabase returned invalid JSON for users?privy_user_id=eq.did%3Aprivy%3Auser_123&select=*",
    );
  });
});
