import { describe, expect, it, vi } from "vitest";

import { precalcOnramp } from "./provider";
import type { OnrampConfig } from "./config";

const config: OnrampConfig = {
  baseUrl: "https://provider.example",
  clientId: "client_123",
  secret: "secret_123",
  serviceId: "svc_123",
  appSymbol: "RUB-USDT",
  providerSymbol: "RUB-USDT",
  network: "TRC20",
  returnUrl: null,
  privyAppId: "privy_app_123",
  supabaseUrl: "https://supabase.example",
  supabaseServiceRoleKey: "service_role_123",
};

describe("providerRequest", () => {
  it("throws a source-specific error when the provider returns HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Bad Gateway</body></html>", {
        status: 502,
        headers: {
          "Content-Type": "text/html",
        },
      }),
    );

    await expect(precalcOnramp(config, 1000)).rejects.toMatchObject({
      message: "Onramp provider returned HTML for /externals/cex/precalc",
    });
  });

  it("throws a source-specific error when the provider returns invalid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await expect(precalcOnramp(config, 1000)).rejects.toMatchObject({
      message: "Onramp provider returned invalid JSON for /externals/cex/precalc",
    });
  });
});
