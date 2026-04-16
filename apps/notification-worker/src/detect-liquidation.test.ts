import { describe, expect, it } from "vitest";
import { detectLiquidationEvents } from "./detect-liquidation";
import type { EligibleUser, PositionSnapshot } from "./types";

const user: EligibleUser = {
  userId: "user-1",
  walletAddress: "0xabc",
  telegramId: "123",
  language: "en",
  preferences: {
    liquidation_alerts: true,
    order_fills: true,
    usdc_deposits: true,
  },
  channelStatus: "active",
};

function makePosition(partial: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    coin: "BTC",
    szi: 1,
    liquidationPx: 100,
    entryPx: 120,
    ...partial,
  };
}

describe("detectLiquidationEvents", () => {
  it("seeds current position risk without backfilling on the first scan", () => {
    const result = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 108 },
      state: null,
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {
        "BTC|long": [10],
      },
    });
  });

  it("emits the next newly crossed band as risk worsens", () => {
    const result = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 104 },
      state: {
        initialized: true,
        activeBandsByPosition: {
          "BTC|long": [10],
        },
      },
      enabled: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      topic: "liquidation_risk",
      idempotencyKey: "liquidation_risk:0xabc:BTC|long:5",
      payload: expect.objectContaining({
        band: 5,
        coin: "BTC",
      }),
    });
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {
        "BTC|long": [10, 5],
      },
    });
  });

  it("clears stored bands after the position returns to safety", () => {
    const result = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 112 },
      state: {
        initialized: true,
        activeBandsByPosition: {
          "BTC|long": [10, 5],
        },
      },
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {
        "BTC|long": [],
      },
    });
  });

  it("drops stored risk state after the position closes", () => {
    const result = detectLiquidationEvents({
      user,
      positions: [],
      midsByCoin: {},
      state: {
        initialized: true,
        activeBandsByPosition: {
          "BTC|long": [10],
        },
      },
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {},
    });
  });
});
