import { describe, expect, it } from "vitest";

import { getOnrampConfig } from "./config";

const baseEnv = {
  ONRAMP_BASE_URL: "http://203.0.113.10:8080",
  ONRAMP_PROXY_TOKEN: "proxy_token_123",
  ONRAMP_SERVICE_ID: "svc_123",
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_123",
};

describe("getOnrampConfig", () => {
  it("requires the proxy token but not provider signing credentials in Vercel", () => {
    const config = getOnrampConfig(baseEnv);

    expect(config.baseUrl).toBe("http://203.0.113.10:8080");
    expect(config.proxyToken).toBe("proxy_token_123");
  });

  it("fails fast when the proxy token is missing", () => {
    const { ONRAMP_PROXY_TOKEN: _proxyToken, ...env } = baseEnv;

    expect(() => getOnrampConfig(env)).toThrow(
      "Missing required environment variable: ONRAMP_PROXY_TOKEN",
    );
  });
});
