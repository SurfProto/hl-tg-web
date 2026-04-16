import { describe, expect, it } from "vitest";
import { detectFillEvents } from "./detect-fills";
import type { EligibleUser, FillRecord } from "./types";

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

function makeFill(partial: Partial<FillRecord> = {}): FillRecord {
  return {
    tid: 100,
    coin: "BTC",
    side: "buy",
    px: 65000,
    sz: 0.1,
    dir: "Open",
    time: 1_710_000_000_000,
    closedPnl: 0,
    ...partial,
  };
}

describe("detectFillEvents", () => {
  it("seeds the fill cursor on first scan without emitting historical fills", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 100 }), makeFill({ tid: 101 })],
      state: null,
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({ initialized: true, maxTid: 101 });
  });

  it("emits new fills after the stored cursor", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 100 }), makeFill({ tid: 101 })],
      state: { initialized: true, maxTid: 100 },
      enabled: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      topic: "order_fill",
      idempotencyKey: "order_fill:0xabc:101",
      payload: expect.objectContaining({
        tid: 101,
        coin: "BTC",
        language: "en",
      }),
    });
    expect(result.state).toEqual({ initialized: true, maxTid: 101 });
  });

  it("advances the cursor even when fill notifications are disabled", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 102 })],
      state: { initialized: true, maxTid: 101 },
      enabled: false,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({ initialized: true, maxTid: 102 });
  });
});
