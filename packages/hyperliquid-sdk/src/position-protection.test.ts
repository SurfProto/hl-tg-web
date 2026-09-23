import { describe, expect, it } from "vitest";

import {
  classifyProtectionOrder,
  findProtectionSideIssue,
  planPositionProtection,
  PROTECTION_SIDE_MESSAGES,
  type ProtectionOrder,
} from "./position-protection";

const MARK = 100;

function order(overrides: Partial<ProtectionOrder> & { oid: number }): ProtectionOrder {
  return {
    coin: "BTC",
    reduceOnly: true,
    isTrigger: true,
    triggerPx: null,
    ...overrides,
  };
}

describe("classifyProtectionOrder", () => {
  it("reads a trigger below the mark as a long's stop and a short's target", () => {
    const below = { isTrigger: true, reduceOnly: true, triggerPx: 90 };
    expect(classifyProtectionOrder(below, "long", MARK)).toBe("stopLoss");
    expect(classifyProtectionOrder(below, "short", MARK)).toBe("takeProfit");
  });

  it("reads a trigger above the mark the other way round", () => {
    const above = { isTrigger: true, reduceOnly: true, triggerPx: 110 };
    expect(classifyProtectionOrder(above, "long", MARK)).toBe("takeProfit");
    expect(classifyProtectionOrder(above, "short", MARK)).toBe("stopLoss");
  });

  it("classifies nothing without a trigger, a reduce-only flag, or a price", () => {
    expect(
      classifyProtectionOrder({ isTrigger: false, reduceOnly: true, triggerPx: 90 }, "long", MARK),
    ).toBeNull();
    expect(
      classifyProtectionOrder({ isTrigger: true, reduceOnly: false, triggerPx: 90 }, "long", MARK),
    ).toBeNull();
    expect(
      classifyProtectionOrder({ isTrigger: true, reduceOnly: true, triggerPx: null }, "long", MARK),
    ).toBeNull();
    expect(
      classifyProtectionOrder({ isTrigger: true, reduceOnly: true, triggerPx: 90 }, "long", null),
    ).toBeNull();
  });

  it("calls a trigger exactly at the mark neither", () => {
    expect(
      classifyProtectionOrder({ isTrigger: true, reduceOnly: true, triggerPx: MARK }, "long", MARK),
    ).toBeNull();
  });
});

describe("planPositionProtection", () => {
  const base = {
    referencePrice: MARK,
    existingOrders: [] as ProtectionOrder[],
    marketName: "BTC",
  };

  it("closes a long by selling and a short by buying", () => {
    expect(
      planPositionProtection({
        ...base,
        positionSzi: 2.5,
        stopLossPx: 90,
        takeProfitPx: null,
      }),
    ).toMatchObject({ direction: "long", side: "sell", size: 2.5 });

    expect(
      planPositionProtection({
        ...base,
        positionSzi: -2.5,
        stopLossPx: 110,
        takeProfitPx: null,
      }),
    ).toMatchObject({ direction: "short", side: "buy", size: 2.5 });
  });

  it("refuses to protect a position that is not there", () => {
    expect(() =>
      planPositionProtection({ ...base, positionSzi: 0, stopLossPx: 90, takeProfitPx: null }),
    ).toThrow(/No open position to protect for BTC/);
    expect(() =>
      planPositionProtection({
        ...base,
        positionSzi: Number.NaN,
        stopLossPx: 90,
        takeProfitPx: null,
      }),
    ).toThrow(/No open position to protect/);
  });

  it("rejects a trigger price that is not a usable number", () => {
    expect(() =>
      planPositionProtection({ ...base, positionSzi: 1, stopLossPx: 0, takeProfitPx: null }),
    ).toThrow(/Stop loss trigger price must be greater than 0/);
    expect(() =>
      planPositionProtection({
        ...base,
        positionSzi: 1,
        stopLossPx: null,
        takeProfitPx: Number.NaN,
      }),
    ).toThrow(/Take profit trigger price must be greater than 0/);
  });

  it("rejects a stop on the wrong side of the mark", () => {
    // A long's stop above the mark would fire immediately, closing the position
    // the moment it is set.
    expect(() =>
      planPositionProtection({ ...base, positionSzi: 1, stopLossPx: 110, takeProfitPx: null }),
    ).toThrow(/Stop loss must be below the current mark price for a long position/);
    expect(() =>
      planPositionProtection({ ...base, positionSzi: -1, stopLossPx: 90, takeProfitPx: null }),
    ).toThrow(/Stop loss must be above the current mark price for a short position/);
  });

  it("rejects a target on the wrong side of the mark", () => {
    expect(() =>
      planPositionProtection({ ...base, positionSzi: 1, stopLossPx: null, takeProfitPx: 90 }),
    ).toThrow(/Take profit must be above the current mark price for a long position/);
    expect(() =>
      planPositionProtection({ ...base, positionSzi: -1, stopLossPx: null, takeProfitPx: 110 }),
    ).toThrow(/Take profit must be below the current mark price for a short position/);
  });

  it("places both sides for an unprotected position", () => {
    expect(
      planPositionProtection({
        ...base,
        positionSzi: 1,
        stopLossPx: 90,
        takeProfitPx: 120,
      }),
    ).toMatchObject({
      cancelOids: [],
      toPlace: [
        { triggerPx: 90, triggerKind: "stopLoss" },
        { triggerPx: 120, triggerKind: "takeProfit" },
      ],
    });
  });

  it("leaves an unchanged side alone", () => {
    // Re-placing an unchanged stop would leave the position unprotected between
    // the cancel and the new order landing.
    const plan = planPositionProtection({
      ...base,
      positionSzi: 1,
      stopLossPx: 90,
      takeProfitPx: 130,
      existingOrders: [
        order({ oid: 1, triggerPx: 90 }),
        order({ oid: 2, triggerPx: 120 }),
      ],
    });

    expect(plan.cancelOids).toEqual([2]);
    expect(plan.toPlace).toEqual([{ triggerPx: 130, triggerKind: "takeProfit" }]);
  });

  it("cancels without replacing when a side is cleared", () => {
    const plan = planPositionProtection({
      ...base,
      positionSzi: 1,
      stopLossPx: null,
      takeProfitPx: 120,
      existingOrders: [
        order({ oid: 1, triggerPx: 90 }),
        order({ oid: 2, triggerPx: 120 }),
      ],
    });

    expect(plan.cancelOids).toEqual([1]);
    expect(plan.toPlace).toEqual([]);
  });

  it("refuses a request that changes nothing", () => {
    expect(() =>
      planPositionProtection({
        ...base,
        positionSzi: 1,
        stopLossPx: 90,
        takeProfitPx: 120,
        existingOrders: [
          order({ oid: 1, triggerPx: 90 }),
          order({ oid: 2, triggerPx: 120 }),
        ],
      }),
    ).toThrow(/No protection changes to apply/);
  });

  it("ignores orders belonging to another market", () => {
    const plan = planPositionProtection({
      ...base,
      positionSzi: 1,
      stopLossPx: 90,
      takeProfitPx: null,
      existingOrders: [order({ oid: 9, coin: "ETH", triggerPx: 90 })],
    });

    expect(plan.cancelOids).toEqual([]);
    expect(plan.toPlace).toEqual([{ triggerPx: 90, triggerKind: "stopLoss" }]);
  });

  it("ignores a resting limit order that is not protection", () => {
    const plan = planPositionProtection({
      ...base,
      positionSzi: 1,
      stopLossPx: 90,
      takeProfitPx: null,
      existingOrders: [
        order({ oid: 7, triggerPx: 90, isTrigger: false }),
        order({ oid: 8, triggerPx: 90, reduceOnly: false }),
      ],
    });

    expect(plan.cancelOids).toEqual([]);
    expect(plan.toPlace).toEqual([{ triggerPx: 90, triggerKind: "stopLoss" }]);
  });

  it("reads existing orders against the short's direction, not the long's", () => {
    // 110 protects a short as its stop. Classified as a long's take profit it
    // would be diffed against the wrong request and cancelled by mistake.
    const plan = planPositionProtection({
      ...base,
      positionSzi: -1,
      stopLossPx: 110,
      takeProfitPx: 80,
      existingOrders: [order({ oid: 4, triggerPx: 110 })],
    });

    expect(plan.cancelOids).toEqual([]);
    expect(plan.toPlace).toEqual([{ triggerPx: 80, triggerKind: "takeProfit" }]);
  });

  it("keeps only the first stop when a position carries several", () => {
    // Scaling out at several levels is a deliberate strategy, so a changed stop
    // cancels one order rather than clearing the ladder.
    const plan = planPositionProtection({
      ...base,
      positionSzi: 1,
      stopLossPx: 95,
      takeProfitPx: null,
      existingOrders: [
        order({ oid: 1, triggerPx: 90 }),
        order({ oid: 2, triggerPx: 85 }),
      ],
    });

    expect(plan.cancelOids).toEqual([1]);
    expect(plan.toPlace).toEqual([{ triggerPx: 95, triggerKind: "stopLoss" }]);
  });
});

/**
 * The pre-submit half of the direction rule.
 *
 * planPositionProtection only runs after the entry order has filled, so until
 * this predicate existed a wrong-sided stop opened the position and then
 * refused the protection — a live leveraged trade with nothing guarding it.
 * TradePage now calls this at the review step.
 */
describe("findProtectionSideIssue", () => {
  it("accepts triggers that straddle the mark correctly", () => {
    expect(
      findProtectionSideIssue({
        direction: "long",
        referencePrice: 100,
        stopLossPx: 90,
        takeProfitPx: 110,
      }),
    ).toBeNull();
    expect(
      findProtectionSideIssue({
        direction: "short",
        referencePrice: 100,
        stopLossPx: 110,
        takeProfitPx: 90,
      }),
    ).toBeNull();
  });

  it("names a stop on the wrong side of the mark", () => {
    expect(
      findProtectionSideIssue({
        direction: "long",
        referencePrice: 100,
        stopLossPx: 110,
      }),
    ).toBe("stopLossAboveMarkOnLong");
    expect(
      findProtectionSideIssue({
        direction: "short",
        referencePrice: 100,
        stopLossPx: 90,
      }),
    ).toBe("stopLossBelowMarkOnShort");
  });

  it("names a take profit on the wrong side of the mark", () => {
    expect(
      findProtectionSideIssue({
        direction: "long",
        referencePrice: 100,
        takeProfitPx: 90,
      }),
    ).toBe("takeProfitBelowMarkOnLong");
    expect(
      findProtectionSideIssue({
        direction: "short",
        referencePrice: 100,
        takeProfitPx: 110,
      }),
    ).toBe("takeProfitAboveMarkOnShort");
  });

  /**
   * The exact sequence that shipped: a stop set for a long, then the side
   * toggled to sell. The draft used to survive the toggle, so this reached
   * the exchange as a short whose stop sat on the take-profit side.
   */
  it("catches a long's stop reused on a short", () => {
    expect(
      findProtectionSideIssue({
        direction: "short",
        referencePrice: 60000,
        stopLossPx: 58000,
      }),
    ).toBe("stopLossBelowMarkOnShort");
  });

  it("stays silent when there is no usable reference price", () => {
    // Refusing here would block an order over a price the app has not
    // fetched; the order path checks again with its own reference.
    expect(
      findProtectionSideIssue({
        direction: "long",
        referencePrice: 0,
        stopLossPx: 110,
      }),
    ).toBeNull();
    expect(
      findProtectionSideIssue({
        direction: "long",
        referencePrice: Number.NaN,
        stopLossPx: 110,
      }),
    ).toBeNull();
  });

  it("has a message for every issue it can return", () => {
    const issues = [
      "stopLossAboveMarkOnLong",
      "stopLossBelowMarkOnShort",
      "takeProfitBelowMarkOnLong",
      "takeProfitAboveMarkOnShort",
    ] as const;
    for (const issue of issues) {
      expect(PROTECTION_SIDE_MESSAGES[issue]).toBeTruthy();
    }
  });
});
