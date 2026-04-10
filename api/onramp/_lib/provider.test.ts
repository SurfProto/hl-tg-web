import { describe, expect, it, vi } from "vitest";

import { precalcOnramp } from "./provider";
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

describe("providerRequest", () => {
  it("sends onramp requests to the proxy with the proxy token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        success: true,
        data: {
          symbol: "RUB-USDT",
          payin_breakdown: {
            amount: "1000",
            currency: "RUB",
          },
          payout_breakdown: {
            amount: "10",
            currency: "USDT",
          },
        },
      }),
    );

    await precalcOnramp(config, 1000);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://provider.example/externals/cex/precalc"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Onramp-Proxy-Token": "proxy_token_123",
        },
      }),
    );
  });

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
      message:
        "Onramp provider returned HTML for /externals/cex/precalc (host: provider.example, status: 502, content-type: text/html)",
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
      message:
        "Onramp provider returned invalid JSON for /externals/cex/precalc (host: provider.example, status: 200, content-type: application/json)",
    });
  });
});
