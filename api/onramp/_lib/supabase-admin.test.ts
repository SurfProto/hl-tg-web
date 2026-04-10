import { describe, expect, it, vi } from "vitest";

import { getRecentOrders, getUserByPrivyUserId, upsertOnrampUser } from "./supabase-admin";
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

  it("queries recent terminal onramp orders for a user", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            provider_order_id: "ord_done",
            external_order_id: "ext_done",
            service_id: "svc_123",
            provider_state: "SUCCESS",
            app_state: "success",
            payin_amount: "1000",
            payin_currency: "RUB",
            payout_amount: "12.33",
            payout_currency: "USDT",
            fee_amount: null,
            invoice_url: null,
            invoice_url_expires_at: null,
            error_code: null,
            error_message: null,
            last_synced_at: "2026-04-10T08:00:00.000Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const orders = await getRecentOrders(config, "user_123", 5);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://supabase.example/rest/v1/onramp_orders?user_id=eq.user_123&app_state=in.(success,failed,expired)&select=provider_order_id,external_order_id,service_id,provider_state,app_state,payin_amount,payin_currency,payout_amount,payout_currency,fee_amount,invoice_url,invoice_url_expires_at,error_code,error_message,last_synced_at&order=created_at.desc&limit=5",
      expect.any(Object),
    );
    expect(orders[0]).toMatchObject({
      id: "ord_done",
      appState: "success",
    });
  });

  it("throws a user-not-found error before building an update payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await expect(
      upsertOnrampUser(config, {
        privyUserId: "did:privy:user_123",
        walletAddress: null,
        email: "user@example.com",
        kycStatus: "unknown",
        kycSource: "local_allowlist",
        kycCheckedAt: "2026-04-10T08:00:00.000Z",
      }),
    ).rejects.toThrow("USER_NOT_FOUND");
  });
});
