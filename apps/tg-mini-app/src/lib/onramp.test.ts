import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapOnramp,
  checkoutOnramp,
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

  it("bootstraps without transmitting profile identity or payout selection", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ success: true, data: {} }),
    );

    await bootstrapOnramp("token_123");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("sends the selected payout address only during checkout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ success: true, data: {} }),
    );

    await checkoutOnramp("token_123", 1000, "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", "key-1");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 1000,
      idempotencyKey: "key-1",
      payoutAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    });
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

  it("allows quote requests when bootstrap limits were not prefetched", () => {
    expect(validateOnrampAmount("1000", null)).toEqual({
      ok: true,
      amount: 1000,
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

describe("root vercel deployment config", () => {
  it("owns the API routes and enables Fluid Compute from the repository root", async () => {
    const rawConfig = await readFile(
      resolve(process.cwd(), "../../vercel.json"),
      "utf8",
    );
    const config = JSON.parse(rawConfig) as {
      fluid?: boolean;
      routes?: Array<{ src?: string; dest?: string }>;
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.fluid).toBe(true);
    expect(config.routes?.[0]).toEqual({
      src: "/api/(.*)",
      dest: "/api/$1",
    });

    expect(config.routes).toContainEqual({
      src: "/(.*)",
      dest: "/index.html",
    });
    // The raffle is deferred until the core trading path is verified, and
    // runWeeklyRaffle pays prizes through sendRewardUsdc — so it must not be
    // scheduled, or setting CRON_SECRET silently starts moving real USDC.
    expect(
      config.crons?.some((cron) => cron.path === "/api/rewards/weekly-raffle"),
    ).toBeFalsy();
  });
});
