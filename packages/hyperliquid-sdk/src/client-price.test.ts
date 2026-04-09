import { describe, expect, it, vi } from "vitest";
import { HyperliquidClient } from "./client";

function createClient() {
  const client = new HyperliquidClient({ testnet: true });
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
  return client;
}

describe("HyperliquidClient.getMarketPrice", () => {
  it("returns a cached mid when one is already available", async () => {
    const client = createClient();
    (client as any).midsCache = {
      data: { BTC: "101.25" },
      expiresAt: Date.now() + 5_000,
    };
    const getAssetCtx = vi.spyOn(client, "getAssetCtx").mockResolvedValueOnce({
      coin: "BTC",
      markPx: 99,
      prevDayPx: 98,
      dayNtlVlm: 0,
      openInterest: 0,
      funding: 0,
      oraclePx: 99,
      change24h: 0,
    });

    await expect(client.getMarketPrice("BTC")).resolves.toBe(101.25);
    expect(getAssetCtx).not.toHaveBeenCalled();
  });

  it("falls back to asset context mark price when cached mids are unavailable", async () => {
    const client = createClient();
    vi.spyOn(client, "getAssetCtx").mockResolvedValueOnce({
      coin: "BTC",
      markPx: 100.5,
      prevDayPx: 99,
      dayNtlVlm: 0,
      openInterest: 0,
      funding: 0,
      oraclePx: 100.5,
      change24h: 0,
    });
    const getOrderbook = vi.spyOn(client, "getOrderbook");

    await expect(client.getMarketPrice("BTC")).resolves.toBe(100.5);
    expect(getOrderbook).not.toHaveBeenCalled();
  });

  it("falls back to the orderbook midpoint when asset context is unavailable", async () => {
    const client = createClient();
    vi.spyOn(client, "getAssetCtx").mockResolvedValueOnce(null);
    vi.spyOn(client, "getOrderbook").mockResolvedValueOnce({
      coin: "BTC",
      time: Date.now(),
      levels: {
        bids: [{ px: 100, sz: 1, n: 1 }],
        asks: [{ px: 102, sz: 1, n: 1 }],
      },
    } as any);

    await expect(client.getMarketPrice("BTC")).resolves.toBe(101);
  });
});

describe("HyperliquidClient market-price fallbacks", () => {
  it("validates a market order using the per-market fallback price", async () => {
    const client = createClient();
    vi.spyOn(client, "getAssetCtx").mockResolvedValueOnce({
      coin: "BTC",
      markPx: 100,
      prevDayPx: 99,
      dayNtlVlm: 0,
      openInterest: 0,
      funding: 0,
      oraclePx: 100,
      change24h: 0,
    });

    const result = await client.validateOrder(
      {
        coin: "BTC",
        side: "buy",
        sizeUsd: 25,
        orderType: "market",
        reduceOnly: false,
        leverage: 5,
        marketType: "perp",
      },
      { availableBalance: 100 },
    );

    expect(result.isValid).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
