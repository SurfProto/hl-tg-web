import { describe, expect, it, vi } from "vitest";

import { createProxyHandler } from "./proxy.mjs";

const env = {
  ONRAMP_PROVIDER_BASE_URL: "https://moonlander-dev.tsunami.cash/api/v2",
  ONRAMP_CLIENT_ID: "client_123",
  ONRAMP_SECRET: "secret_123",
  ONRAMP_PROXY_TOKEN: "proxy_token_123",
};

function request(path, init = {}) {
  return new Request(`http://proxy.local${path}`, init);
}

describe("onramp proxy handler", () => {
  it("rejects requests without the shared proxy token", async () => {
    const handler = createProxyHandler({ env });

    const response = await handler(request("/externals/cex/precalc"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "UNAUTHORIZED",
    });
  });

  it("rejects paths outside the onramp provider allowlist", async () => {
    const handler = createProxyHandler({ env });

    const response = await handler(
      request("/not-allowed", {
        headers: {
          "X-Onramp-Proxy-Token": "proxy_token_123",
        },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "NOT_FOUND",
    });
  });

  it("signs and forwards provider requests from the proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          ok: true,
        },
      }),
    );
    const handler = createProxyHandler({ env, fetchImpl: fetchMock, now: () => 1_700_000_000_000 });

    const response = await handler(
      request("/externals/cex/precalc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Onramp-Proxy-Token": "proxy_token_123",
        },
        body: JSON.stringify({
          amount: 1000,
          direction: "FORWARD",
          fee_strategy: "SERVICE",
          service_id: "svc_123",
          symbol: "RUB-USDT",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://moonlander-dev.tsunami.cash/api/v2/externals/cex/precalc"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Client-ID": "client_123",
          "X-Timestamp": "1700000000",
          "X-Signature": expect.any(String),
        }),
      }),
    );
  });
});
