import { describe, expect, it } from "vitest";

import { normalizeMarketSymbol } from "./symbol";

describe("normalizeMarketSymbol", () => {
  it("uppercases a plain perp, as before", () => {
    expect(normalizeMarketSymbol("btc")).toBe("BTC");
    expect(normalizeMarketSymbol("BTC")).toBe("BTC");
  });

  it("keeps the dex prefix lowercase and the coin uppercase", () => {
    // The exchange keys these as xyz:GOLD. Uppercasing the whole thing is what
    // made /api/market/ticker answer null for every HIP-3 market.
    expect(normalizeMarketSymbol("xyz:GOLD")).toBe("xyz:GOLD");
    expect(normalizeMarketSymbol("XYZ:GOLD")).toBe("xyz:GOLD");
    expect(normalizeMarketSymbol("xyz:gold")).toBe("xyz:GOLD");
  });

  it("canonicalises real mainnet symbols", () => {
    expect(normalizeMarketSymbol("MKTS:us500")).toBe("mkts:US500");
    expect(normalizeMarketSymbol("io:anth")).toBe("io:ANTH");
  });

  it("gives one cache key whatever case the caller used", () => {
    const variants = ["xyz:GOLD", "XYZ:gold", "Xyz:Gold"];
    expect(new Set(variants.map(normalizeMarketSymbol)).size).toBe(1);
  });

  it("leaves a quote suffix alone", () => {
    expect(normalizeMarketSymbol("xyz:gold-usdc")).toBe("xyz:GOLD-USDC");
  });

  it("handles an empty symbol without throwing", () => {
    expect(normalizeMarketSymbol("")).toBe("");
  });
});
