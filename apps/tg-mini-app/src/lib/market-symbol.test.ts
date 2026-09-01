import { describe, expect, it } from "vitest";
import type { Position } from "@repo/types";
import {
  canonicalCoinSymbol,
  findPositionForSymbol,
  isSameMarketSymbol,
  stripDexPrefix,
} from "./market-symbol";

function position(coin: string, overrides: Partial<Position> = {}): Position {
  return {
    coin,
    szi: 1,
    leverage: { type: "cross", value: 10 },
    entryPx: 100,
    positionValue: 1000,
    unrealizedPnl: 5,
    returnOnEquity: 0.05,
    liquidationPx: 50,
    marginUsed: 100,
    maxLeverage: 20,
    ...overrides,
  };
}

describe("stripDexPrefix", () => {
  it("leaves an ordinary perp alone", () => {
    expect(stripDexPrefix("BTC")).toBe("BTC");
  });

  it("drops the dex from a HIP-3 symbol", () => {
    expect(stripDexPrefix("xyz:GOLD-USDC")).toBe("GOLD-USDC");
  });
});

describe("canonicalCoinSymbol", () => {
  it("folds the display form back to the exchange's own", () => {
    expect(canonicalCoinSymbol("GOLD-USDC:xyz")).toBe("xyz:GOLD-USDC");
  });

  it("leaves the exchange's own form untouched", () => {
    expect(canonicalCoinSymbol("xyz:GOLD-USDC")).toBe("xyz:GOLD-USDC");
    expect(canonicalCoinSymbol("BTC")).toBe("BTC");
  });
});

describe("isSameMarketSymbol", () => {
  it("matches a HIP-3 market across both spellings", () => {
    expect(isSameMarketSymbol("xyz:GOLD-USDC", "GOLD-USDC:xyz")).toBe(true);
  });

  /**
   * The whole point of carrying the prefix. `BTC` and `xyz:BTC` are different
   * markets on different dexes; showing one market's position on the other's
   * page would misstate the user's exposure in both directions.
   */
  it("keeps a bare symbol and a prefixed one apart", () => {
    expect(isSameMarketSymbol("BTC", "xyz:BTC")).toBe(false);
    expect(isSameMarketSymbol("xyz:BTC", "BTC")).toBe(false);
  });

  it("keeps two dexes listing the same coin apart", () => {
    expect(isSameMarketSymbol("xyz:GOLD-USDC", "abc:GOLD-USDC")).toBe(false);
  });
});

describe("findPositionForSymbol", () => {
  const positions = [
    { position: position("BTC") },
    { position: position("xyz:GOLD-USDC", { szi: -2 }) },
  ];

  it("finds the position for a bare perp", () => {
    expect(findPositionForSymbol(positions, "BTC")?.coin).toBe("BTC");
  });

  it("finds a HIP-3 position from a prefixed route symbol", () => {
    expect(findPositionForSymbol(positions, "xyz:GOLD-USDC")?.szi).toBe(-2);
  });

  it("finds a HIP-3 position from the display form too", () => {
    expect(findPositionForSymbol(positions, "GOLD-USDC:xyz")?.szi).toBe(-2);
  });

  it("returns nothing for a market the user is not in", () => {
    expect(findPositionForSymbol(positions, "ETH")).toBeNull();
    expect(findPositionForSymbol(positions, "abc:GOLD-USDC")).toBeNull();
  });

  it("ignores a flat position the exchange still reports", () => {
    expect(
      findPositionForSymbol([{ position: position("ETH", { szi: 0 }) }], "ETH"),
    ).toBeNull();
  });

  it("survives an account whose state has not loaded", () => {
    expect(findPositionForSymbol(undefined, "BTC")).toBeNull();
  });
});
