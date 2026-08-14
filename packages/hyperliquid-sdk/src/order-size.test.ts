import { describe, expect, it } from "vitest";

import { formatOrderSize, inferSzDecimalsFromMinBaseSize } from "./order-validation";

/**
 * formatOrderSize produces the size string sent to the exchange, and had no
 * direct tests. The invariant that protects the user is that it must never
 * produce a size *larger* than requested: validateOrderInput checks the balance
 * against the requested notional, so a size that rounds up is an order the
 * balance was never checked against.
 */

const BTC = { name: "BTC", szDecimals: 5 };
const ETH = { name: "ETH", szDecimals: 4 };
const WHOLE = { name: "WHOLE", szDecimals: 0 };

describe("formatOrderSize", () => {
  it("truncates to the market's szDecimals", () => {
    expect(formatOrderSize(0.000416666666, BTC)).toBe("0.00041");
    expect(formatOrderSize(1.23456789, ETH)).toBe("1.2345");
  });

  it("drops the fractional part entirely at szDecimals 0", () => {
    expect(formatOrderSize(7.99, WHOLE)).toBe("7");
  });

  it("strips trailing zeros rather than padding", () => {
    expect(formatOrderSize(0.5, BTC)).toBe("0.5");
    expect(formatOrderSize(2, ETH)).toBe("2");
  });

  it("rejects a size that is not a usable positive number", () => {
    expect(() => formatOrderSize(0, BTC)).toThrow(/Invalid size/);
    expect(() => formatOrderSize(-1, BTC)).toThrow(/Invalid size/);
    expect(() => formatOrderSize(Number.NaN, BTC)).toThrow(/Invalid size/);
    expect(() => formatOrderSize(Number.POSITIVE_INFINITY, BTC)).toThrow(/Invalid size/);
  });

  it("rejects a size that truncates away to zero", () => {
    // Below one lot at 5dp, so there is no size the exchange would accept.
    expect(() => formatOrderSize(0.000009, BTC)).toThrow(/too small/);
  });

  /**
   * The invariant. truncateToDecimals computes
   *   Math.trunc((value + Number.EPSILON) * factor) / factor
   * and Number.EPSILON is an absolute constant — the gap between 1 and the next
   * double. Scaled by 10**szDecimals it is meaningful for small sizes and
   * meaningless for large ones, so whether it changes the result depends on
   * magnitude. Where it does bite, it can carry a value that sits just below a
   * decimal boundary up over it, yielding a larger order than requested.
   */
  it("never returns a size larger than the requested size", () => {
    const markets = [BTC, ETH, WHOLE, { name: "X", szDecimals: 2 }, { name: "Y", szDecimals: 8 }];
    const offenders: Array<{ market: string; input: number; output: string }> = [];

    for (const market of markets) {
      const factor = 10 ** market.szDecimals;
      for (let k = 1; k <= 400; k++) {
        // Values sitting a hair below an exact multiple of the lot size, which
        // is where a float nudge upwards changes the truncation.
        const justBelow = k / factor - Number.EPSILON * (k / factor);
        if (justBelow <= 0) continue;
        let output: string;
        try {
          output = formatOrderSize(justBelow, market);
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

  it("returns the largest lot-aligned size not exceeding the request", () => {
    const cases: Array<[number, { name: string; szDecimals: number }, string]> = [
      [0.00041999999999999996, BTC, "0.00041"],
      [0.99999999, ETH, "0.9999"],
      [3.9999999999, WHOLE, "3"],
    ];
    for (const [input, market, expected] of cases) {
      expect(formatOrderSize(input, market)).toBe(expected);
      expect(Number(formatOrderSize(input, market))).toBeLessThanOrEqual(input);
    }
  });
});

describe("inferSzDecimalsFromMinBaseSize", () => {
  it("reads the decimal count from a plain decimal", () => {
    expect(inferSzDecimalsFromMinBaseSize(0.001)).toBe(3);
    expect(inferSzDecimalsFromMinBaseSize(0.1)).toBe(1);
  });

  it("handles exponential notation, which is how small lot sizes stringify", () => {
    // 1e-5 stringifies as "0.00001", but 1e-7 becomes "1e-7". Written as
    // literals rather than 10 ** -5: `**` is not exact across V8 versions, and
    // this test failed on CI's Node 20 while passing on Node 24 for a year of
    // nobody looking.
    expect(inferSzDecimalsFromMinBaseSize(1e-5)).toBe(5);
    expect(inferSzDecimalsFromMinBaseSize(1e-7)).toBe(7);
  });

  it("ignores float noise in a lot size instead of asking for 21 decimals", () => {
    // What Node 20 computes for 10 ** -5: one ulp above 1e-5, printing as
    // twenty-one decimals. Counting its digits gave szDecimals 21, and
    // szDecimals formats the size sent to the exchange.
    expect(inferSzDecimalsFromMinBaseSize(0.000010000000000000003)).toBe(5);
    expect(inferSzDecimalsFromMinBaseSize(0.30000000000000004)).toBe(1);
  });

  it("still distinguishes neighbouring lot sizes", () => {
    expect(inferSzDecimalsFromMinBaseSize(0.00012)).toBe(5);
    expect(inferSzDecimalsFromMinBaseSize(0.0001)).toBe(4);
    expect(inferSzDecimalsFromMinBaseSize(0.5)).toBe(1);
  });

  it("treats whole and invalid lot sizes as zero decimals", () => {
    expect(inferSzDecimalsFromMinBaseSize(1)).toBe(0);
    expect(inferSzDecimalsFromMinBaseSize(0)).toBe(0);
    expect(inferSzDecimalsFromMinBaseSize(-1)).toBe(0);
    expect(inferSzDecimalsFromMinBaseSize(Number.NaN)).toBe(0);
  });
});
