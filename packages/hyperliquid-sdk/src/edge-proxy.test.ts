// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, fetchAccountSnapshot } from "./edge-proxy";

function stub(status: number, payload: unknown, contentType = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
      headers: { get: () => contentType },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("requestJson", () => {
  it("throws an ApiError carrying the status and code the API refused with", async () => {
    stub(503, { success: false, error: "warming", code: "CACHE_WARMING" });
    const rejection = fetchAccountSnapshot("tok");
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.toMatchObject({ status: 503, code: "CACHE_WARMING", message: "warming" });
  });

  it("treats success:false on a 200 as a refusal too", async () => {
    stub(200, { success: false, error: "nope", code: "DENIED" });
    await expect(fetchAccountSnapshot("tok")).rejects.toMatchObject({ status: 200, code: "DENIED" });
  });

  it("returns the envelope's data on success", async () => {
    stub(200, { success: true, data: { userState: {}, spotBalance: { balances: [] } } });
    await expect(fetchAccountSnapshot("tok")).resolves.toMatchObject({ userState: {} });
  });
});
