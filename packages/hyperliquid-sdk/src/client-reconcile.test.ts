import { describe, expect, it } from "vitest";
import { HyperliquidClient } from "./client";

const CLOID = "0x1a170000000000000000000000deadbeef";

function createClient() {
  const client = new HyperliquidClient({
    testnet: true,
    walletAddress: "0xabc",
  });
  (client as any).marketCache = {
    perp: {
      BTC: {
        asset: 0,
        aliases: ["BTC"],
        baseCoin: "BTC",
        marketType: "perp",
        maxLeverage: 50,
        minBaseSize: 0.0001,
        minNotionalUsd: 10,
        name: "BTC",
        onlyIsolated: false,
        priceDecimals: 1,
        szDecimals: 4,
      },
    },
    spot: {},
    spotMarkets: [],
    perpMarkets: [],
    perpDexs: [],
    spotTokenNames: new Set<string>(),
  };
  (client as any).getTradingClient = async () => ({});
  (client as any).ensureBuilderApproval = async () => undefined;
  (client as any).ensurePerpLeverage = async () => undefined;
  // The submission itself dies ambiguously: the response never came back.
  (client as any).retryOrder = async () => {
    throw new Error("fetch failed");
  };
  return client;
}

const ORDER = {
  cloid: CLOID,
  coin: "BTC",
  limitPx: 100,
  orderType: "limit" as const,
  reduceOnly: false,
  side: "buy" as const,
  sizeUsd: 100,
  marketType: "perp" as const,
};

describe("placeOrder reconciliation", () => {
  /**
   * A timeout leaves the order's fate unknown; reporting "failed" to a user
   * whose order actually rests invites a doubled resubmission, and the
   * in-memory double-tap guard cannot cover a retry the user is meant to
   * make. The client order id is asked about before the error is passed on.
   */
  it("returns success when the failed submission actually rests in the book", async () => {
    const client = createClient();
    (client as any).getOpenOrders = async () => [
      { oid: 7, cloid: CLOID, coin: "BTC" },
    ];
    (client as any).getFills = async () => [];

    await expect(client.placeOrder(ORDER)).resolves.toMatchObject({
      reconciled: true,
      status: "resting",
      oid: 7,
    });
  });

  it("returns success when the failed submission already filled", async () => {
    const client = createClient();
    (client as any).getOpenOrders = async () => [];
    (client as any).getFills = async () => [{ oid: 9, cloid: CLOID }];

    await expect(client.placeOrder(ORDER)).resolves.toMatchObject({
      reconciled: true,
      status: "filled",
      oid: 9,
    });
  });

  it("rethrows when the exchange has no trace of the order", async () => {
    const client = createClient();
    (client as any).getOpenOrders = async () => [];
    (client as any).getFills = async () => [];

    await expect(client.placeOrder(ORDER)).rejects.toThrow();
  });
});
