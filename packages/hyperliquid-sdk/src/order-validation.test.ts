import { describe, expect, it } from "vitest";

import type { Order } from "@repo/types";

import {
  validateOrderInput,
  type OrderValidationMarket,
  type ValidateOrderOptions,
} from "./order-validation";

const PERP: OrderValidationMarket = {
  name: "BTC",
  marketType: "perp",
  minNotionalUsd: 10,
  minBaseSize: 0.00001,
  szDecimals: 5,
  maxLeverage: 40,
};

function order(overrides: Partial<Order> = {}): Order {
  return {
    coin: "BTC",
    side: "buy",
    sizeUsd: 100,
    orderType: "market",
    reduceOnly: false,
    leverage: 5,
    marketType: "perp",
    ...overrides,
  };
}

function validate(
  o: Partial<Order> = {},
  market: Partial<OrderValidationMarket> = {},
  availableBalance?: number,
  options?: ValidateOrderOptions,
) {
  return validateOrderInput(
    order(o),
    { ...PERP, ...market },
    100_000,
    availableBalance,
    options,
  );
}

describe("validateOrderInput", () => {
  it("accepts a well-formed order inside the balance", () => {
    expect(validate({}, {}, 100).isValid).toBe(true);
  });

  it("rejects a size below the minimum notional", () => {
    const result = validate({ sizeUsd: 5 }, {}, 1_000);
    expect(result.isValid).toBe(false);
    expect(result.reason).toMatch(/Minimum order value/);
  });

  it("rejects an unusable reference price", () => {
    const result = validateOrderInput(order(), PERP, 0, 1_000);
    expect(result.isValid).toBe(false);
    expect(result.reason).toMatch(/Reference price unavailable/);
  });

  describe("leverage cap", () => {
    // Nothing checked maxLeverage, so an out-of-range value shrank the required
    // margin, passed local validation, and was rejected by the exchange.
    it("rejects leverage above the market maximum", () => {
      const result = validate({ leverage: 100 }, {}, 1_000_000);
      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/Maximum leverage for BTC is 40x/);
    });

    it("accepts leverage at the maximum", () => {
      expect(validate({ leverage: 40 }, {}, 1_000).isValid).toBe(true);
    });

    it("ignores leverage on spot markets", () => {
      expect(
        validate(
          { leverage: 100, marketType: "spot" },
          { marketType: "spot", maxLeverage: 1 },
          1_000,
        ).isValid,
      ).toBe(true);
    });

    it("still validates when a market declares no maximum", () => {
      expect(validate({ leverage: 100 }, { maxLeverage: undefined }, 1_000).isValid).toBe(true);
    });
  });

  describe("balance", () => {
    it("leaves headroom for fees rather than allowing an exact-balance order", () => {
      // 100 USD at 5x needs 20 USD of margin. Exactly 20 available used to pass
      // and then fail at the exchange once fees were applied.
      expect(validate({}, {}, 20).isValid).toBe(false);
      expect(validate({}, {}, 20.5).isValid).toBe(true);
    });

    it("skips the check when no balance is supplied and none is required", () => {
      // The order-construction path inside the client has no balance to hand
      // and relies on the exchange's margin check.
      expect(validate({}, {}, undefined).isValid).toBe(true);
    });

    it("fails closed when a balance is required but unknown", () => {
      const result = validate({}, {}, undefined, { requireBalance: true });
      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/Balance unavailable/);
    });

    it("fails closed when a required balance is NaN", () => {
      expect(validate({}, {}, Number.NaN, { requireBalance: true }).isValid).toBe(false);
    });

    it("requires the full notional on spot rather than a margin fraction", () => {
      const spot = { marketType: "spot" as const, maxLeverage: 1 };
      expect(validate({ marketType: "spot" }, spot, 20).isValid).toBe(false);
      expect(validate({ marketType: "spot" }, spot, 101).isValid).toBe(true);
    });
  });

  it("rejects a size that rounds below the market lot size", () => {
    const result = validateOrderInput(
      order({ sizeUsd: 10 }),
      { ...PERP, minBaseSize: 1, szDecimals: 0 },
      100_000,
      1_000,
    );
    expect(result.isValid).toBe(false);
    expect(result.reason).toMatch(/below the minimum lot size/);
  });
});
