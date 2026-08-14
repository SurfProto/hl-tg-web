import { describe, expect, it } from "vitest";

import {
  formatStableAmount,
  getSpotAvailableBalance,
  parseBalanceAmount,
  resolveStableSwapLeg,
  roundStableAmount,
  type StableSpotMarket,
} from "./stable-swap";

describe("roundStableAmount", () => {
  it("keeps six decimals", () => {
    expect(roundStableAmount(1.2345678)).toBe(1.234567);
    expect(roundStableAmount(100)).toBe(100);
  });

  it("rounds down, so the amount is still there when the order lands", () => {
    expect(roundStableAmount(0.9999999)).toBe(0.999999);
    expect(roundStableAmount(1.0000009)).toBe(1);
  });
});

describe("formatStableAmount", () => {
  it("drops the decimal point from a whole amount", () => {
    expect(formatStableAmount(100)).toBe("100");
    expect(formatStableAmount(1000)).toBe("1000");
  });

  it("keeps the significant part of a fraction", () => {
    expect(formatStableAmount(0.5)).toBe("0.5");
    expect(formatStableAmount(12.34)).toBe("12.34");
    expect(formatStableAmount(0.000001)).toBe("0.000001");
  });

  it("renders an amount that rounds away as zero", () => {
    expect(formatStableAmount(0.0000001)).toBe("0");
  });
});

describe("parseBalanceAmount", () => {
  it("reads the strings the exchange sends", () => {
    expect(parseBalanceAmount("12.5")).toBe(12.5);
    expect(parseBalanceAmount(12.5)).toBe(12.5);
  });

  it("treats anything unreadable as zero", () => {
    expect(parseBalanceAmount(null)).toBe(0);
    expect(parseBalanceAmount(undefined)).toBe(0);
    expect(parseBalanceAmount("abc")).toBe(0);
    expect(parseBalanceAmount({})).toBe(0);
  });
});

describe("getSpotAvailableBalance", () => {
  const spotBalance = {
    balances: [
      { coin: "usdc", total: "100", hold: "25" },
      { coin: "USDH", total: "40", hold: "0" },
    ],
  };

  it("subtracts what is held against resting orders", () => {
    expect(getSpotAvailableBalance(spotBalance, "USDC")).toBe(75);
    expect(getSpotAvailableBalance(spotBalance, "USDH")).toBe(40);
  });

  it("returns zero for an asset with no balance at all", () => {
    expect(getSpotAvailableBalance(spotBalance, "USDT")).toBe(0);
    expect(getSpotAvailableBalance(null, "USDC")).toBe(0);
    expect(getSpotAvailableBalance({}, "USDC")).toBe(0);
  });

  it("never reports a negative balance", () => {
    expect(
      getSpotAvailableBalance(
        { balances: [{ coin: "USDC", total: "5", hold: "9" }] },
        "USDC",
      ),
    ).toBe(0);
  });
});

describe("resolveStableSwapLeg", () => {
  const markets: StableSpotMarket[] = [
    { index: 166, baseName: "USDH", quoteName: "USDC" },
    { index: 200, baseName: "USDT", quoteName: "USDC" },
  ];

  it("buys the target asset on a market quoted in what is being spent", () => {
    expect(resolveStableSwapLeg(markets, "USDC", "USDH")).toEqual({
      coin: "@166",
      side: "buy",
      marketName: "USDH/USDC",
    });
  });

  it("sells on the same market when the direction is reversed", () => {
    // Only one direction of a pair exists, so USDH -> USDC is a sell on
    // USDH/USDC, not a buy on a market that does not exist.
    expect(resolveStableSwapLeg(markets, "USDH", "USDC")).toEqual({
      coin: "@166",
      side: "sell",
      marketName: "USDH/USDC",
    });
  });

  it("matches market names case-insensitively", () => {
    expect(
      resolveStableSwapLeg(
        [{ index: 3, baseName: "usdh", quoteName: "usdc" }],
        "USDC",
        "USDH",
      ),
    ).toMatchObject({ side: "buy", coin: "@3" });
  });

  it("refuses a pair the exchange does not list", () => {
    expect(() => resolveStableSwapLeg(markets, "USDH", "USDT")).toThrow(
      /No supported spot market found for USDH -> USDT/,
    );
  });
});
