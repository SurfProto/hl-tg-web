import { describe, expect, it } from "vitest";

import {
  MARKET_ORDER_SLIPPAGE,
  formatPrice,
  getAggressiveMarketPrice,
  limitSignificantFigures,
  orderbookMidpoint,
  parsePositiveNumber,
} from "./order-price";

const BTC = { name: "BTC", priceDecimals: 1 };
const CHEAP = { name: "CHEAP", priceDecimals: 5 };

describe("limitSignificantFigures", () => {
  it("keeps at most the requested number of significant digits", () => {
    expect(limitSignificantFigures("123456.789", 5)).toBe("12345");
    expect(limitSignificantFigures("1.23456789", 5)).toBe("1.2345");
  });

  it("does not count leading zeros as significant", () => {
    expect(limitSignificantFigures("0.00012345678", 5)).toBe("0.00012345");
  });

  it("gives a bare fraction an integer part, since '.5' would not parse", () => {
    expect(limitSignificantFigures(".5", 5)).toBe("0.5");
  });

  it("strips trailing zeros rather than padding", () => {
    expect(limitSignificantFigures("1.50000", 5)).toBe("1.5");
    expect(limitSignificantFigures("100.00", 5)).toBe("100");
  });

  it("cuts rather than rounds", () => {
    // 1.23459 to five figures is 1.2346 rounded, 1.2345 cut.
    expect(limitSignificantFigures("1.23459", 5)).toBe("1.2345");
  });
});

describe("formatPrice", () => {
  it("truncates to the market's price decimals", () => {
    expect(formatPrice(101.27, BTC)).toBe("101.2");
    expect(formatPrice(0.000123456, CHEAP)).toBe("0.00012");
  });

  it("caps at five significant figures", () => {
    expect(formatPrice(123456.7, { name: "BIG", priceDecimals: 2 })).toBe(
      "12345",
    );
  });

  it("rejects a price that is not a usable positive number", () => {
    expect(() => formatPrice(0, BTC)).toThrow(/Invalid price/);
    expect(() => formatPrice(-1, BTC)).toThrow(/Invalid price/);
    expect(() => formatPrice(Number.NaN, BTC)).toThrow(/Invalid price/);
    expect(() => formatPrice(Number.POSITIVE_INFINITY, BTC)).toThrow(
      /Invalid price/,
    );
  });

  it("rejects a price that truncates away to zero", () => {
    expect(() => formatPrice(0.000001, CHEAP)).toThrow(/rounded to zero/);
  });

  /**
   * The regression. client.ts truncated with
   *   Math.trunc((value + Number.EPSILON) * factor) / factor
   * which carries a value sitting just below a tick boundary over it. 362f6c8
   * removed that from the size path and left it on the price path, where a buy
   * then bids above the price the caller asked for.
   */
  it("never returns a price above the requested price", () => {
    expect(formatPrice(1.9999999999999998, { name: "X", priceDecimals: 4 })).toBe(
      "1.9999",
    );
    expect(formatPrice(0.00041999999999999996, CHEAP)).toBe("0.00041");
    expect(formatPrice(0.29999999999999993, { name: "Y", priceDecimals: 4 })).toBe(
      "0.2999",
    );
  });

  it("holds that invariant across tick boundaries", () => {
    const markets = [
      { name: "A", priceDecimals: 0 },
      { name: "B", priceDecimals: 1 },
      { name: "C", priceDecimals: 2 },
      { name: "D", priceDecimals: 5 },
    ];
    const offenders: Array<{ market: string; input: number; output: string }> =
      [];

    for (const market of markets) {
      const factor = 10 ** market.priceDecimals;
      for (let k = 1; k <= 400; k++) {
        const justBelow = k / factor - Number.EPSILON * (k / factor);
        if (justBelow <= 0) continue;
        let output: string;
        try {
          output = formatPrice(justBelow, market);
        } catch {
          continue;
        }
        if (Number(output) > justBelow) {
          offenders.push({ market: market.name, input: justBelow, output });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("getAggressiveMarketPrice", () => {
  it("bids above the mid and offers below it", () => {
    expect(getAggressiveMarketPrice(100, "buy")).toBeCloseTo(103, 10);
    expect(getAggressiveMarketPrice(100, "sell")).toBeCloseTo(97, 10);
  });

  it("caps worst-case slippage at the documented tolerance", () => {
    expect(MARKET_ORDER_SLIPPAGE).toBe(0.03);
    const mid = 64000;
    expect(getAggressiveMarketPrice(mid, "buy") / mid - 1).toBeCloseTo(0.03, 10);
    expect(1 - getAggressiveMarketPrice(mid, "sell") / mid).toBeCloseTo(
      0.03,
      10,
    );
  });
});

describe("parsePositiveNumber", () => {
  it("accepts the strings the exchange actually sends", () => {
    expect(parsePositiveNumber("101.25")).toBe(101.25);
    expect(parsePositiveNumber(101.25)).toBe(101.25);
  });

  it("rejects anything that is not a usable price", () => {
    expect(parsePositiveNumber("0")).toBeNull();
    expect(parsePositiveNumber(-1)).toBeNull();
    expect(parsePositiveNumber(null)).toBeNull();
    expect(parsePositiveNumber(undefined)).toBeNull();
    expect(parsePositiveNumber("not a price")).toBeNull();
    expect(parsePositiveNumber(Number.NaN)).toBeNull();
    expect(parsePositiveNumber({})).toBeNull();
  });
});

describe("orderbookMidpoint", () => {
  it("averages the top of each side", () => {
    expect(orderbookMidpoint("100", "102")).toBe(101);
  });

  it("uses whichever side exists when the book is one-sided", () => {
    expect(orderbookMidpoint("100", undefined)).toBe(100);
    expect(orderbookMidpoint(null, "102")).toBe(102);
  });

  it("returns null when neither side has a usable price", () => {
    expect(orderbookMidpoint(undefined, undefined)).toBeNull();
    expect(orderbookMidpoint("0", "-5")).toBeNull();
  });
});
