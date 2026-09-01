import { describe, expect, it } from "vitest";
import {
  formatPercent,
  formatPnl,
  formatPositionSize,
  formatUsd,
  formatUsdPrice,
  formatUsdPriceParts,
} from "./format";

describe("formatUsdPrice", () => {
  // The defect this replaced: every result went through parseFloat, so a price
  // ending in zero rendered narrower than the same price a tick earlier.
  it("keeps trailing zeros", () => {
    expect(formatUsdPrice(999.5)).toBe("$999.50");
    expect(formatUsdPrice(91.1)).toBe("$91.10");
    expect(formatUsdPrice(7.55)).toBe("$7.5500");
    expect(formatUsdPrice(0.09)).toBe("$0.09000");
  });

  // Above 1000 there was a maximum of 2 with no minimum, so a price alternated
  // between "$79,161" and "$79,161.40" as it moved.
  it("always shows cents at four figures and above", () => {
    expect(formatUsdPrice(79161.4)).toBe("$79,161.40");
    expect(formatUsdPrice(79161)).toBe("$79,161.00");
    expect(formatUsdPrice(1000)).toBe("$1,000.00");
  });

  it("holds a constant width within a magnitude band", () => {
    const band = [12.3, 99.99, 1234.5, 79161.4].map(formatUsdPrice);
    const decimals = band.map((p) => p.split(".")[1].length);
    expect(new Set(decimals).size).toBe(1);
  });

  it("keeps precision on low-priced assets", () => {
    expect(formatUsdPrice(7.5548)).toBe("$7.5548");
    expect(formatUsdPrice(0.09572)).toBe("$0.09572");
    expect(formatUsdPrice(0.000012)).toBe("$0.00001200");
  });

  it("refuses to invent a price", () => {
    expect(formatUsdPrice(0)).toBe("—");
    expect(formatUsdPrice(-1)).toBe("—");
    expect(formatUsdPrice(Number.NaN)).toBe("—");
    expect(formatUsdPrice(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatUsdPriceParts", () => {
  it("splits exactly what formatUsdPrice renders", () => {
    for (const price of [79161.4, 999.5, 91.15, 7.5548, 0.09572]) {
      const { integer, decimal } = formatUsdPriceParts(price);
      expect(`$${integer}.${decimal}`).toBe(formatUsdPrice(price));
    }
  });

  // The coin page's hero used its own bands and its tooltip used another set,
  // so the same number could be shown two ways on one screen.
  it("agrees with the row formatter on the same price", () => {
    expect(formatUsdPriceParts(79161.4)).toEqual({ integer: "79,161", decimal: "40" });
    expect(formatUsdPriceParts(7.5548)).toEqual({ integer: "7", decimal: "5548" });
  });

  it("falls back rather than throwing on an unusable price", () => {
    expect(formatUsdPriceParts(0)).toEqual({ integer: "0", decimal: "00" });
    expect(formatUsdPriceParts(Number.NaN)).toEqual({ integer: "0", decimal: "00" });
  });
});

describe("formatPnl", () => {
  // The defect these carry over from PositionsPage: a loss rendered as "$5",
  // leaving color as the only thing separating it from a five-dollar win.
  it("always states the sign", () => {
    expect(formatPnl(5)).toBe("+$5");
    expect(formatPnl(-5)).toBe("−$5");
    expect(formatPnl(0)).toBe("+$0");
  });
});

describe("formatUsd", () => {
  it("states an amount without a sign", () => {
    expect(formatUsd(1234.567)).toBe("$1,234.57");
    expect(formatUsd(-40)).toBe("$40");
  });
});

describe("formatPercent", () => {
  it("marks a gain and leaves a loss its own minus", () => {
    expect(formatPercent(11.111)).toBe("+11.11%");
    expect(formatPercent(-11.111)).toBe("-11.11%");
  });
});

describe("formatPositionSize", () => {
  // Sizes arrive from float subtraction, so they carry binary dust.
  it("drops the dust without rounding the size away", () => {
    expect(formatPositionSize(0.30000000000000004)).toBe("0.3");
    expect(formatPositionSize(0.000001)).toBe("0.000001");
    expect(formatPositionSize(2)).toBe("2");
  });
});
