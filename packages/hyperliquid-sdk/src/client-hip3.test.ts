import { beforeEach, describe, expect, it, vi } from "vitest";

import { HyperliquidClient } from "./client";

// Three requests build the cache: spotMeta, metaAndAssetCtxs and perpDexs. A
// HIP-3 dex universe costs one more, and only when a symbol on that dex is
// asked for. Mainnet lists 9 dexes and testnet lists 247, which is what made
// the eager version rate-limit itself before an order could be signed.

const SPOT_META = {
  tokens: [
    { index: 0, name: "BTC", szDecimals: 5 },
    { index: 1, name: "USDC", szDecimals: 2 },
  ],
  universe: [{ name: "@0", index: 0, tokens: [0, 1] }],
};

const BASE_META_AND_CTXS = [
  {
    universe: [
      { name: "BTC", szDecimals: 4, maxLeverage: 40 },
      { name: "ETH", szDecimals: 3, maxLeverage: 25 },
    ],
  },
  [{ markPx: "50000" }, { markPx: "3000" }],
];

// Index 0 is null — the base perp dex, which is not a HIP-3 dex. "xyz" is
// therefore dexIndex 1 and "abc" is dexIndex 2.
const PERP_DEXS = [null, { name: "xyz" }, { name: "abc" }];

const DEX_UNIVERSES: Record<string, any[]> = {
  // A delisted market first, so the asset id has to come from the unfiltered
  // position rather than the filtered one.
  xyz: [
    { name: "OLD-USDC", szDecimals: 2, maxLeverage: 5, isDelisted: true },
    { name: "GOLD-USDC", szDecimals: 2, maxLeverage: 10 },
  ],
  abc: [{ name: "OIL-USDC", szDecimals: 1, maxLeverage: 8 }],
};

type InfoRequest = { type: string; dex?: string };

function createClient(options: { failDexOnce?: string } = {}) {
  const client = new HyperliquidClient({ testnet: true });
  const requests: InfoRequest[] = [];
  const failed = new Set<string>();

  (client as any).getPublicClient = async () => ({
    spotMeta: async () => SPOT_META,
  });

  (client as any).postInfo = async (request: InfoRequest) => {
    requests.push(request);

    if (request.type === "metaAndAssetCtxs" && !request.dex) {
      return BASE_META_AND_CTXS;
    }
    if (request.type === "metaAndAssetCtxs" && request.dex) {
      if (options.failDexOnce === request.dex && !failed.has(request.dex)) {
        failed.add(request.dex);
        throw new Error("429 rate limited");
      }
      const universe = DEX_UNIVERSES[request.dex];
      if (!universe) throw new Error(`unexpected dex ${request.dex}`);
      return [{ universe }, universe.map(() => ({ markPx: "100" }))];
    }
    if (request.type === "perpDexs") return PERP_DEXS;
    if (request.type === "allMids" && !request.dex) return { BTC: "50000" };
    if (request.type === "allMids" && request.dex) {
      return { [`${request.dex}:GOLD-USDC`]: "2400" };
    }
    if (request.type === "spotMetaAndAssetCtxs") return null;
    throw new Error(`unexpected info request ${request.type}`);
  };

  const dexRequests = () =>
    requests.filter((r) => r.type === "metaAndAssetCtxs" && r.dex);

  return { client, requests, dexRequests };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("market cache", () => {
  it("builds without touching a single HIP-3 dex", async () => {
    const { client, requests, dexRequests } = createClient();

    await client.resolveMarket("BTC");

    expect(dexRequests()).toEqual([]);
    expect(requests.map((r) => r.type).sort()).toEqual([
      "metaAndAssetCtxs",
      "perpDexs",
    ]);
  });

  it("still resolves standard perps and spot", async () => {
    const { client } = createClient();

    await expect(client.resolveMarket("BTC")).resolves.toMatchObject({
      asset: 0,
      marketType: "perp",
    });
    await expect(client.resolveMarket("@0", "spot")).resolves.toMatchObject({
      asset: 10000,
      marketType: "spot",
    });
  });
});

describe("lazy HIP-3 loading", () => {
  it("loads only the dex the symbol names", async () => {
    const { client, dexRequests } = createClient();

    const market = await client.resolveMarket("xyz:GOLD-USDC");

    expect(dexRequests()).toEqual([{ type: "metaAndAssetCtxs", dex: "xyz" }]);
    expect(market.name).toBe("xyz:GOLD-USDC");
    expect(market.isHip3).toBe(true);
  });

  it("derives the asset id from the unfiltered universe position", async () => {
    // 100000 + dexIndex * 10000 + index. "xyz" is dexIndex 1 and GOLD-USDC sits
    // at index 1 behind a delisted market, so 110001. Getting this wrong sends
    // the order to a different market.
    const { client } = createClient();

    const market = await client.resolveMarket("xyz:GOLD-USDC");

    expect(market.asset).toBe(110001);
  });

  it("matches the dex prefix regardless of case", async () => {
    const { client } = createClient();

    await expect(client.resolveMarket("XYZ:GOLD-USDC")).resolves.toMatchObject({
      asset: 110001,
    });
  });

  it("keeps dexes independent", async () => {
    const { client, dexRequests } = createClient();

    const gold = await client.resolveMarket("xyz:GOLD-USDC");
    const oil = await client.resolveMarket("abc:OIL-USDC");

    expect(gold.asset).toBe(110001);
    expect(oil.asset).toBe(120000);
    expect(dexRequests()).toHaveLength(2);
  });

  it("fetches a dex once, however many symbols resolve against it", async () => {
    const { client, dexRequests } = createClient();

    await client.resolveMarket("xyz:GOLD-USDC");
    await client.resolveMarket("xyz:GOLD-USDC");

    expect(dexRequests()).toHaveLength(1);
  });

  it("shares one request between concurrent resolves of the same dex", async () => {
    const { client, dexRequests } = createClient();

    await Promise.all([
      client.resolveMarket("xyz:GOLD-USDC"),
      client.resolveMarket("xyz:GOLD-USDC"),
    ]);

    expect(dexRequests()).toHaveLength(1);
  });

  it("reports an unknown symbol on a real dex without failing the cache", async () => {
    const { client } = createClient();

    await expect(client.resolveMarket("xyz:NOPE")).rejects.toThrow(
      "Unknown market",
    );
    await expect(client.resolveMarket("BTC")).resolves.toMatchObject({
      asset: 0,
    });
  });

  it("does not fetch anything for a prefix that is not a dex", async () => {
    const { client, dexRequests } = createClient();

    await expect(client.resolveMarket("nope:GOLD-USDC")).rejects.toThrow(
      "Unknown market",
    );
    expect(dexRequests()).toEqual([]);
  });

  it("retries a dex that failed rather than disabling it for the session", async () => {
    // A 429 on one dex used to be swallowed for the lifetime of the cache.
    // Memoizing the load must not make that permanent.
    const { client, dexRequests } = createClient({ failDexOnce: "xyz" });

    await expect(client.resolveMarket("xyz:GOLD-USDC")).rejects.toThrow(
      "Unknown market",
    );

    await expect(client.resolveMarket("xyz:GOLD-USDC")).resolves.toMatchObject({
      asset: 110001,
    });
    expect(dexRequests()).toHaveLength(2);
  });

  it("leaves standard perps tradeable when a dex is down", async () => {
    const { client } = createClient({ failDexOnce: "xyz" });

    await expect(client.resolveMarket("xyz:GOLD-USDC")).rejects.toThrow();

    await expect(client.resolveMarket("BTC")).resolves.toMatchObject({
      asset: 0,
    });
  });
});

describe("callers that need every dex", () => {
  it("getMarkets loads all of them", async () => {
    const { client, dexRequests } = createClient();

    const markets = await client.getMarkets();

    expect(dexRequests()).toHaveLength(2);
    expect(markets.perp.map((m: any) => m.name).sort()).toEqual([
      "BTC",
      "ETH",
      "abc:OIL-USDC",
      "xyz:GOLD-USDC",
    ]);
  });

  it("loadAllHip3Dexes is idempotent", async () => {
    const { client, dexRequests } = createClient();

    await client.loadAllHip3Dexes();
    await client.loadAllHip3Dexes();

    expect(dexRequests()).toHaveLength(2);
  });
});

describe("per-dex fan-out", () => {
  it("getMids queries only the dexes that are loaded", async () => {
    const { client, requests } = createClient();
    await client.resolveMarket("xyz:GOLD-USDC");

    const mids = await client.getMids();

    expect(
      requests.filter((r) => r.type === "allMids" && r.dex).map((r) => r.dex),
    ).toEqual(["xyz"]);
    expect(mids["xyz:GOLD-USDC"]).toBe("2400");
  });

  it("getMids skips every dex when only standard perps are in play", async () => {
    const { client, requests } = createClient();
    await client.resolveMarket("BTC");

    await client.getMids();

    expect(requests.filter((r) => r.type === "allMids" && r.dex)).toEqual([]);
  });

  it("pricing a standard perp refreshes no dex contexts", async () => {
    // getAssetCtx runs on the order path. Refreshing 247 testnet dexes to price
    // one BTC order is the fan-out that blocked testnet orders.
    const { client, dexRequests } = createClient();
    await client.resolveMarket("BTC");

    await client.getAssetCtx("BTC");

    expect(dexRequests()).toEqual([]);
  });
});

// The bug this pins: getUserState used to fan clearinghouseState out over
// getLoadedPerpDexs() only. The app reads markets from the edge endpoint and
// the account snapshot builds a fresh client per request, so nothing had ever
// loaded a dex universe by the time state was read — the loaded set was empty
// on every call, and a HIP-3 position was never returned. A user holding all
// of their collateral on one HIP-3 dex saw an empty account.
describe("getUserState across HIP-3 dexes", () => {
  const EMPTY = { marginSummary: { accountValue: "0" }, assetPositions: [] };

  function createStateClient() {
    const { client, requests, dexRequests } = createClient();
    const inner = (client as any).postInfo;

    (client as any).walletAddress = "0xuser";
    (client as any).postInfo = async (request: any) => {
      // The inner mock records what it handles; anything answered here has to
      // record itself or it never appears in `requests`.
      if (request.type !== "metaAndAssetCtxs" && request.type !== "perpDexs") {
        requests.push(request);
      }
      if (request.type === "clearinghouseState") {
        if (request.dex === "xyz") {
          return {
            marginSummary: { accountValue: "8.96", totalRawUsd: "8.96", totalMarginUsed: "1.00" },
            assetPositions: [
              {
                type: "oneWay",
                position: {
                  // The dex reports its own bare symbol.
                  coin: "GOLD-USDC",
                  szi: "3.084",
                  leverage: { type: "isolated", value: "10" },
                  entryPx: "32.482",
                  liquidationPx: "30.72",
                  marginUsed: "1.00",
                  maxLeverage: "10",
                  positionValue: "8.96",
                  returnOnEquity: "-0.1",
                  unrealizedPnl: "-1.21",
                },
              },
            ],
          };
        }
        return EMPTY;
      }
      if (request.type === "spotClearinghouseState") return { balances: [] };
      if (request.type === "userAbstraction") return null;
      if (request.type === "userDexAbstraction") return null;
      return inner(request);
    };

    const stateDexes = () =>
      requests.filter((r: any) => r.type === "clearinghouseState").map((r: any) => r.dex ?? "main");

    return { client, requests, stateDexes, dexRequests };
  }

  it("asks every named dex, not only the ones already loaded", async () => {
    const { client, stateDexes } = createStateClient();

    await client.getUserState({ fresh: true });

    // No symbol was resolved first, so under the old behaviour this was ["main"].
    expect(stateDexes().sort()).toEqual(["abc", "main", "xyz"]);
  });

  it("returns the position, qualified with its dex", async () => {
    const { client } = createStateClient();

    const state = await client.getUserState({ fresh: true });
    const coins = state.assetPositions.map((p: any) => p.position.coin);

    expect(coins).toContain("xyz:GOLD-USDC");
    expect(state.assetPositions).toHaveLength(1);
  });

  it("loads the universe only for the dex holding something", async () => {
    const { client, dexRequests } = createStateClient();

    await client.getUserState({ fresh: true });

    // "abc" answered empty, so its universe is never fetched — the cheap half
    // is asking, the expensive half is loading.
    expect(dexRequests().map((r: any) => r.dex)).toEqual(["xyz"]);
  });

  it("counts the HIP-3 collateral toward equity", async () => {
    const { client } = createStateClient();

    const state = await client.getUserState({ fresh: true });

    // Was $0.00 while the user held a leveraged position.
    expect(state.marginSummary.accountValue).toBeGreaterThan(0);
  });
});

// Widening the fan-out from zero calls to ten gave ten builder-run dexes shared
// fate with the base account. postInfo throws on any non-OK status, so without
// a per-call catch one flaky dex blanks every position, balance and equity
// figure the app has — and gates closePosition and ensurePerpLeverage, which
// read the same state.
describe("a dex that will not answer", () => {
  function createClientWithFailingDex() {
    const { client, requests } = createClient();
    const inner = (client as any).postInfo;

    (client as any).walletAddress = "0xuser";
    (client as any).postInfo = async (request: any) => {
      if (request.type === "clearinghouseState") {
        if (request.dex === "abc") {
          throw new Error("Info request failed with status 503");
        }
        if (request.dex === "xyz") {
          return {
            marginSummary: { accountValue: "8.96", totalRawUsd: "8.96", totalMarginUsed: "1.00" },
            assetPositions: [
              {
                type: "oneWay",
                position: {
                  coin: "GOLD-USDC",
                  szi: "3.084",
                  leverage: { type: "isolated", value: "10" },
                  entryPx: "32.482",
                  liquidationPx: "30.72",
                  marginUsed: "1.00",
                  maxLeverage: "10",
                  positionValue: "8.96",
                  returnOnEquity: "-0.1",
                  unrealizedPnl: "-1.21",
                },
              },
            ],
          };
        }
        // The base account.
        return {
          marginSummary: { accountValue: "500", totalRawUsd: "500", totalMarginUsed: "0" },
          assetPositions: [],
        };
      }
      if (request.type === "spotClearinghouseState") return { balances: [] };
      if (request.type === "userAbstraction") return null;
      if (request.type === "userDexAbstraction") return null;
      return inner(request);
    };

    return { client, requests };
  }

  it("still returns the account rather than throwing", async () => {
    const { client } = createClientWithFailingDex();

    await expect(client.getUserState({ fresh: true })).resolves.toBeTruthy();
  });

  it("keeps the positions the healthy dexes did report", async () => {
    const { client } = createClientWithFailingDex();

    const state = await client.getUserState({ fresh: true });

    expect(state.assetPositions.map((p: any) => p.position.coin)).toContain(
      "xyz:GOLD-USDC",
    );
  });

  it("does not blank the base account because a builder dex is down", async () => {
    const { client } = createClientWithFailingDex();

    const state = await client.getUserState({ fresh: true });

    // 500 of base collateral has nothing to do with whether "abc" answered.
    expect(state.marginSummary.accountValue).toBeGreaterThan(400);
  });
});
