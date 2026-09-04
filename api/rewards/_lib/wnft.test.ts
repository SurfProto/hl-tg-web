import { describe, expect, it } from "vitest";
import type { BuilderFillRow } from "./builder-fills";
import { deriveWnftQualification } from "./wnft";

const CONFIG = {
  minOrderNotionalUsd: 100,
  sameOrderWindowSeconds: 2,
  minQualifyingOrders: 2,
};

function fill(partial: Partial<BuilderFillRow> & { occurredAt: string; px: number; sz: number }): BuilderFillRow {
  return {
    builderFeeUsd: 0.05,
    coin: "BTC",
    isTrigger: false,
    rowKey: `${partial.occurredAt}:1`,
    side: "B",
    walletAddress: "0xabc",
    ...partial,
  };
}

describe("deriveWnftQualification", () => {
  it("converts on two distinct qualifying orders", () => {
    const result = deriveWnftQualification(
      [
        fill({ occurredAt: "2026-02-01T10:00:00.000Z", px: 100000, sz: 0.002 }), // $200
        fill({ occurredAt: "2026-02-01T14:00:00.000Z", px: 100000, sz: 0.002 }), // $200
      ],
      CONFIG,
    );

    expect(result.qualifies).toBe(true);
    expect(result.qualifyingOrderCount).toBe(2);
    expect(result.qualifyingNotionalUsd).toBeCloseTo(400);
    // The conversion moment is the *second* qualifying order.
    expect(result.convertedAt).toBe("2026-02-01T14:00:00.000Z");
  });

  it("does not convert on a single large order", () => {
    const result = deriveWnftQualification(
      [fill({ occurredAt: "2026-02-01T10:00:00.000Z", px: 100000, sz: 0.02 })], // $2000, one order
      CONFIG,
    );

    expect(result.qualifies).toBe(false);
    expect(result.qualifyingOrderCount).toBe(1);
    expect(result.convertedAt).toBeNull();
  });

  it("treats one order's partial fills as one order, not several", () => {
    // A single market order filling across three price levels inside one
    // second — same coin, same side, within the window. One order, $300.
    const result = deriveWnftQualification(
      [
        fill({ occurredAt: "2026-02-01T10:00:00.000Z", px: 100000, sz: 0.001 }),
        fill({ occurredAt: "2026-02-01T10:00:00.500Z", px: 100100, sz: 0.001 }),
        fill({ occurredAt: "2026-02-01T10:00:01.000Z", px: 100200, sz: 0.001 }),
      ],
      CONFIG,
    );

    // ~$300 of notional, but only one reconstructed order — no conversion.
    expect(result.qualifyingOrderCount).toBe(1);
    expect(result.qualifies).toBe(false);
  });

  it("does not sum many tiny fills across a day into a fake large trade", () => {
    // Ten $20 fills, each its own order (spaced past the window). None reaches
    // the $100 floor, so none qualifies however much they add up to.
    const fills = Array.from({ length: 10 }, (_, i) =>
      fill({
        occurredAt: `2026-02-01T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
        px: 100000,
        sz: 0.0002, // $20
      }),
    );

    const result = deriveWnftQualification(fills, CONFIG);

    expect(result.qualifyingOrderCount).toBe(0);
    expect(result.qualifies).toBe(false);
  });

  it("separates same-coin orders that are far apart in time", () => {
    const result = deriveWnftQualification(
      [
        fill({ occurredAt: "2026-02-01T10:00:00.000Z", px: 100000, sz: 0.002 }),
        fill({ occurredAt: "2026-02-01T10:00:10.000Z", px: 100000, sz: 0.002 }), // 10s later > 2s window
      ],
      CONFIG,
    );

    expect(result.qualifyingOrderCount).toBe(2);
    expect(result.qualifies).toBe(true);
  });

  it("separates concurrent orders on different coins or sides", () => {
    const result = deriveWnftQualification(
      [
        fill({ coin: "BTC", side: "B", occurredAt: "2026-02-01T10:00:00.000Z", px: 100000, sz: 0.002 }),
        fill({ coin: "ETH", side: "B", occurredAt: "2026-02-01T10:00:00.000Z", px: 4000, sz: 0.05 }), // $200, same instant, different coin
      ],
      CONFIG,
    );

    expect(result.qualifyingOrderCount).toBe(2);
    expect(result.qualifies).toBe(true);
  });

  it("ignores non-positive and unparseable fills without throwing", () => {
    const result = deriveWnftQualification(
      [
        fill({ occurredAt: "2026-02-01T10:00:00.000Z", px: 0, sz: 5 }),
        fill({ occurredAt: "not-a-date", px: 100000, sz: 0.002 }),
      ],
      CONFIG,
    );

    expect(result.qualifyingOrderCount).toBe(0);
    expect(result.qualifies).toBe(false);
  });

  it("honours a higher order requirement", () => {
    const twoOrders = [
      fill({ occurredAt: "2026-02-01T10:00:00.000Z", px: 100000, sz: 0.002 }),
      fill({ occurredAt: "2026-02-01T14:00:00.000Z", px: 100000, sz: 0.002 }),
    ];
    expect(
      deriveWnftQualification(twoOrders, { ...CONFIG, minQualifyingOrders: 3 }).qualifies,
    ).toBe(false);
  });
});
