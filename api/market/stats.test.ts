import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./stats";
import { __resetRedisMemoryForTests } from "./_lib/redis";

const UNIVERSE = [{ name: "BTC" }, { name: "ETH" }];
const CTXS = [
  { markPx: "77000", prevDayPx: "76000", dayNtlVlm: "1", openInterest: "2", funding: "0", oraclePx: "77000" },
  { markPx: "4000", prevDayPx: "3900", dayNtlVlm: "1", openInterest: "2", funding: "0", oraclePx: "4000" },
];

function stubUpstream() {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const payloads: Record<string, unknown> = {
      metaAndAssetCtxs: body.dex
        ? [{ universe: [{ name: "GOLD" }] }, [{ ...CTXS[0], markPx: "4593" }]]
        : [{ universe: UNIVERSE }, CTXS],
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
  return fetchMock;
}

function createResponse() {
  const res: any = {
    statusCode: null as number | null,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return res;
}

const request = (query: Record<string, string> = {}) => ({ method: "GET", query, headers: {} });

beforeEach(() => {
  __resetRedisMemoryForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetRedisMemoryForTests();
});

describe("GET /api/market/stats", () => {
  it("returns every market when no symbol is given", async () => {
    stubUpstream();
    const response = createResponse();

    await handler(request(), response);

    expect(Object.keys(response.body.data).sort()).toEqual(["BTC", "ETH", "xyz:GOLD"]);
  });

  it("returns one entry when a symbol is given", async () => {
    stubUpstream();
    const response = createResponse();

    await handler(request({ symbol: "BTC" }), response);

    expect(response.body.data).toMatchObject({ coin: "BTC", markPx: 77000 });
  });

  it("resolves a HIP-3 symbol whatever case the caller used", async () => {
    stubUpstream();
    const response = createResponse();

    await handler(request({ symbol: "XYZ:gold" }), response);

    expect(response.body.data).toMatchObject({ coin: "xyz:GOLD" });
  });

  it("answers null for a market that does not exist", async () => {
    stubUpstream();
    const response = createResponse();

    await handler(request({ symbol: "NOPE" }), response);

    expect(response.body.data).toBeNull();
  });

  it("filters from the shared cache rather than rebuilding per symbol", async () => {
    // The point of filtering after the cache read: asking for three symbols must
    // not cost three fan-outs.
    const fetchMock = stubUpstream();

    await handler(request(), createResponse());
    const afterFullBuild = fetchMock.mock.calls.length;

    await handler(request({ symbol: "BTC" }), createResponse());
    await handler(request({ symbol: "ETH" }), createResponse());
    await handler(request({ symbol: "xyz:GOLD" }), createResponse());

    expect(fetchMock.mock.calls.length).toBe(afterFullBuild);
  });
});
