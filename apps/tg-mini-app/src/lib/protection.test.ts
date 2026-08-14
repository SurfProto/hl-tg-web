import { describe, expect, it } from "vitest";
import type { OpenOrder } from "@repo/types";

import {
  classifyProtectionOrder,
  createProtectionDraft,
  getProtectionPnl,
  getProtectionPresetPrice,
  getProtectionState,
  hasProtectionEnabled,
  parseProtectionPrice,
} from "./protection";

function triggerOrder(overrides: Partial<OpenOrder> & { oid: number }): OpenOrder {
  return {
    coin: "BTC",
    side: "sell",
    limitPx: 0,
    sz: 1,
    timestamp: 0,
    orderType: "market",
    reduceOnly: true,
    isTrigger: true,
    triggerPx: null,
    ...overrides,
  };
}

describe("classifyProtectionOrder", () => {
  it("is the SDK's classifier, so the UI and the order path agree", () => {
    expect(
      classifyProtectionOrder(triggerOrder({ oid: 1, triggerPx: 90 }), "long", 100),
    ).toBe("stopLoss");
    expect(
      classifyProtectionOrder(triggerOrder({ oid: 1, triggerPx: 90 }), "short", 100),
    ).toBe("takeProfit");
  });
});

describe("getProtectionState", () => {
  it("sorts resting triggers into the stop and the target", () => {
    const state = getProtectionState(
      [
        triggerOrder({ oid: 1, triggerPx: 90 }),
        triggerOrder({ oid: 2, triggerPx: 120 }),
      ],
      "long",
      100,
      1,
    );

    expect(state.stopLoss?.oid).toBe(1);
    expect(state.takeProfit?.oid).toBe(2);
    expect(state.needsReview).toBe(false);
  });

  it("keeps the first of several orders on the same side", () => {
    const state = getProtectionState(
      [
        triggerOrder({ oid: 1, triggerPx: 90 }),
        triggerOrder({ oid: 2, triggerPx: 85 }),
      ],
      "long",
      100,
      1,
    );

    expect(state.stopLoss?.oid).toBe(1);
  });

  it("flags protection that no longer covers the whole position", () => {
    // A stop for half the position leaves the other half unprotected, which is
    // the case worth telling the user about.
    const state = getProtectionState(
      [triggerOrder({ oid: 1, triggerPx: 90, sz: 0.5 })],
      "long",
      100,
      1,
    );

    expect(state.needsReview).toBe(true);
  });

  it("does not flag a size that differs only by float noise", () => {
    const state = getProtectionState(
      [triggerOrder({ oid: 1, triggerPx: 90, sz: 0.1 + 0.2 })],
      "long",
      100,
      0.30000000000000004,
    );

    expect(state.needsReview).toBe(false);
  });

  it("compares against the size of a short without its sign", () => {
    const state = getProtectionState(
      [triggerOrder({ oid: 1, triggerPx: 110, sz: 2 })],
      "short",
      100,
      -2,
    );

    expect(state.stopLoss?.oid).toBe(1);
    expect(state.needsReview).toBe(false);
  });

  it("finds nothing without a current price to compare against", () => {
    const state = getProtectionState(
      [triggerOrder({ oid: 1, triggerPx: 90 })],
      "long",
      null,
      1,
    );

    expect(state).toMatchObject({ stopLoss: null, takeProfit: null, needsReview: false });
  });
});

describe("getProtectionPnl", () => {
  it("prices a long's stop as a loss and its target as a gain", () => {
    expect(getProtectionPnl(90, 100, 2, "long")).toBe(-20);
    expect(getProtectionPnl(120, 100, 2, "long")).toBe(40);
  });

  it("reverses both for a short", () => {
    expect(getProtectionPnl(110, 100, 2, "short")).toBe(-20);
    expect(getProtectionPnl(80, 100, 2, "short")).toBe(40);
  });

  it("declines to guess without a trigger, an entry, or a size", () => {
    expect(getProtectionPnl(null, 100, 1, "long")).toBeNull();
    expect(getProtectionPnl(90, null, 1, "long")).toBeNull();
    expect(getProtectionPnl(90, 100, 0, "long")).toBeNull();
    expect(getProtectionPnl(90, 100, Number.NaN, "long")).toBeNull();
  });
});

describe("getProtectionPresetPrice", () => {
  it("puts a long's stop below the price and its target above", () => {
    expect(getProtectionPresetPrice(100, "long", "stopLoss", 10)).toBe("90.00");
    expect(getProtectionPresetPrice(100, "long", "takeProfit", 10)).toBe("110.00");
  });

  it("puts a short's stop above the price and its target below", () => {
    expect(getProtectionPresetPrice(100, "short", "stopLoss", 10)).toBe("110.00");
    expect(getProtectionPresetPrice(100, "short", "takeProfit", 10)).toBe("90.00");
  });

  it("reads a negative percentage as a distance, not a direction", () => {
    expect(getProtectionPresetPrice(100, "long", "stopLoss", -10)).toBe("90.00");
  });

  it("gives a sub-dollar market the decimals it needs", () => {
    expect(getProtectionPresetPrice(0.5, "long", "stopLoss", 10)).toBe("0.450000");
  });
});

describe("protection draft helpers", () => {
  it("builds a draft from the prices already set", () => {
    expect(createProtectionDraft(90, null)).toEqual({
      stopLossEnabled: true,
      stopLossPx: "90",
      takeProfitEnabled: false,
      takeProfitPx: "",
    });
  });

  it("does not count an enabled side with an empty price", () => {
    expect(
      hasProtectionEnabled({
        stopLossEnabled: true,
        stopLossPx: "   ",
        takeProfitEnabled: false,
        takeProfitPx: "",
      }),
    ).toBe(false);
  });

  it("rejects a typed price that is not a usable number", () => {
    expect(parseProtectionPrice("90.5")).toBe(90.5);
    expect(parseProtectionPrice("0")).toBeNull();
    expect(parseProtectionPrice("-1")).toBeNull();
    expect(parseProtectionPrice("")).toBeNull();
    expect(parseProtectionPrice("abc")).toBeNull();
  });
});
