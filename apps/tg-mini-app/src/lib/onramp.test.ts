import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  fetchOnrampQuote,
  getActiveOnrampOrder,
  isOnrampUserVerified,
  isOnrampQuoteCurrent,
  mergeRecentOnrampOrders,
  validateOnrampAmount,
  type OnrampLimits,
  type OnrampOrderStatus,
} from "./onramp";

describe("onramp client", () => {
  it("surfaces a readable error when an API endpoint returns HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Not Found</body></html>", {
        status: 404,
        headers: {
          "Content-Type": "text/html",
        },
      }),
    );

    await expect(fetchOnrampQuote("token_123", 1000)).rejects.toThrow(
      "returned HTML instead of JSON",
    );
  });

  it("does not treat terminal orders as active", () => {
    expect(getActiveOnrampOrder(makeOrder("ord_success", "success"))).toBeNull();
    expect(getActiveOnrampOrder(makeOrder("ord_pending", "payment_pending"))?.id).toBe("ord_pending");
  });

  it("merges terminal orders into recent history without duplicates", () => {
    const existing = [makeOrder("ord_old", "failed")];
    const merged = mergeRecentOnrampOrders(existing, makeOrder("ord_old", "failed"));
    const withNew = mergeRecentOnrampOrders(merged, makeOrder("ord_new", "expired"));

    expect(withNew.map((order) => order.id)).toEqual(["ord_new", "ord_old"]);
  });

  it("marks local and KYC verified statuses as verified", () => {
    expect(isOnrampUserVerified("verified_local")).toBe(true);
    expect(isOnrampUserVerified("verified_kyc")).toBe(true);
    expect(isOnrampUserVerified("unknown")).toBe(false);
  });

  it("requires provider limits before allowing quote requests", () => {
    expect(validateOnrampAmount("1000", null)).toMatchObject({
      ok: false,
      code: "limits_unavailable",
    });
  });

  it("validates amounts against provider limits without hard-coded fallback", () => {
    const limits: OnrampLimits = {
      minAmount: 600,
      maxAmount: 50000,
      currency: "RUB",
    };

    expect(validateOnrampAmount("599", limits)).toMatchObject({
      ok: false,
      code: "below_minimum",
    });
    expect(validateOnrampAmount("50001", limits)).toMatchObject({
      ok: false,
      code: "above_maximum",
    });
    expect(validateOnrampAmount("600", limits)).toEqual({
      ok: true,
      amount: 600,
    });
  });

  it("keeps the payment CTA only while the quote matches the current amount and wallet", () => {
    const quoteRequest = {
      amount: 1000,
      walletAddress: "TQ5nY5fHHx4dGR7N7NjFKTE5qvGGvE7DqK",
    };

    expect(isOnrampQuoteCurrent(quoteRequest, 1000, "TQ5nY5fHHx4dGR7N7NjFKTE5qvGGvE7DqK")).toBe(true);
    expect(isOnrampQuoteCurrent(quoteRequest, 1001, "TQ5nY5fHHx4dGR7N7NjFKTE5qvGGvE7DqK")).toBe(false);
    expect(isOnrampQuoteCurrent(quoteRequest, 1000, "TDifferentWalletAddress111111111111111")).toBe(false);
    expect(isOnrampQuoteCurrent(null, 1000, "TQ5nY5fHHx4dGR7N7NjFKTE5qvGGvE7DqK")).toBe(false);
  });
});

function makeOrder(id: string, appState: OnrampOrderStatus["appState"]): OnrampOrderStatus {
  return {
    id,
    externalOrderId: `${id}_external`,
    providerState: appState.toUpperCase(),
    appState,
    payinAmount: "1000",
    payinCurrency: "RUB",
    payoutAmount: "12.33",
    payoutCurrency: "USDT",
    invoiceUrl: null,
    invoiceUrlExpiresAt: null,
    errorCode: null,
    errorMessage: null,
    lastSyncedAt: "2026-04-10T08:00:00.000Z",
  };
}

describe("tg-mini-app vercel config", () => {
  it("preserves /api routes before the SPA catch-all rewrite", async () => {
    const rawConfig = await readFile(
      new URL("../../vercel.json", import.meta.url),
      "utf8",
    );
    const config = JSON.parse(rawConfig) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites?.[0]).toEqual({
      source: "/api/(.*)",
      destination: "/api/$1",
    });

    expect(config.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });
});
