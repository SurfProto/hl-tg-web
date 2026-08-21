import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRedisMemoryForTests } from "./redis";
import { fetchStats } from "./upstream";

/**
 * The dex list gates the second wave of the stats fan-out, so re-fetching it on
 * every rebuild cost a full upstream round trip to re-learn something that
 * changes when a dex launches.
 */
function stubUpstream() {
  const calls: string[] = [];
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body.dex ? `${body.type}:${body.dex}` : body.type);

    const payloads: Record<string, unknown> = {
      metaAndAssetCtxs: [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "100", prevDayPx: "90", dayNtlVlm: "1", openInterest: "2", funding: "0" }],
      ],
      spotMetaAndAssetCtxs: [{}, []],
      perpDexs: [null, { name: "xyz" }],
    };

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payloads[body.type] ?? {}),
      json: async () => payloads[body.type] ?? {},
      headers: { get: () => "application/json" },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  __resetRedisMemoryForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetRedisMemoryForTests();
});

describe("perpDexs caching", () => {
  it("asks upstream for the dex list once across repeated stats rebuilds", async () => {
    const calls = stubUpstream();

    await fetchStats("mainnet" as any);
    await fetchStats("mainnet" as any);
    await fetchStats("mainnet" as any);

    const dexListCalls = calls.filter((c) => c === "perpDexs");
    expect(dexListCalls).toHaveLength(1);
  });

  it("still fans out per dex on each rebuild, since those carry the prices", async () => {
    const calls = stubUpstream();

    await fetchStats("mainnet" as any);
    await fetchStats("mainnet" as any);

    expect(calls.filter((c) => c === "metaAndAssetCtxs:xyz")).toHaveLength(2);
  });
});
