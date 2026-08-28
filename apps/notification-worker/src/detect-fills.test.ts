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

const T0 = 1_710_000_000_000;

function makeFill(partial: Partial<FillRecord> = {}): FillRecord {
  return {
    tid: 100,
    coin: "BTC",
    side: "buy",
    px: 65000,
    sz: 0.1,
    dir: "Open",
    time: T0,
    closedPnl: 0,
    ...partial,
  };
}

describe("detectFillEvents", () => {
  it("seeds the cursor on first scan without emitting historical fills", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 100, time: T0 }), makeFill({ tid: 101, time: T0 + 1000 })],
      state: null,
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      lastFillAtMs: T0 + 1000,
      seenAtCursor: ["101"],
    });
  });

  it("emits fills newer than the stored cursor", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 100, time: T0 }), makeFill({ tid: 101, time: T0 + 1000 })],
      state: { initialized: true, lastFillAtMs: T0, seenAtCursor: ["100"] },
      enabled: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      topic: "order_fill",
      idempotencyKey: "order_fill:0xabc:101",
      payload: expect.objectContaining({ coin: "BTC", language: "en", tid: 101 }),
    });
  });

  /**
   * The defect this replaces, and the reason order-fill notifications had been
   * silent since April on the first production account.
   *
   * The cursor was the highest `tid` seen, on the assumption Hyperliquid issues
   * them in order. It does not — these two ids are real, from that account: a
   * fill on 23 August carried 865817447693567 and one the next day carried
   * 35167167033945. Once the account recorded its single largest id, every
   * later fill compared smaller and was dropped, permanently and silently.
   */
  it("emits a later fill whose id happens to be smaller", () => {
    const result = detectFillEvents({
      user,
      fills: [
        makeFill({ tid: 865_817_447_693_567, time: T0 }),
        makeFill({ tid: 35_167_167_033_945, time: T0 + 60_000 }),
      ],
      state: {
        initialized: true,
        lastFillAtMs: T0,
        seenAtCursor: ["865817447693567"],
      },
      enabled: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.idempotencyKey).toBe("order_fill:0xabc:35167167033945");
  });

  /**
   * A state row written by the previous version has a `maxTid` and no time
   * cursor. Those accounts carry a backlog of every fill since their
   * notifications went quiet — 109 of them on the first production account —
   * and delivering that backlog as individual messages would be a worse failure
   * than the silence it replaces.
   */
  it("re-baselines old tid state silently instead of replaying the backlog", () => {
    const result = detectFillEvents({
      user,
      fills: [
        makeFill({ tid: 1, time: T0 }),
        makeFill({ tid: 2, time: T0 + 1000 }),
        makeFill({ tid: 3, time: T0 + 2000 }),
      ],
      state: { initialized: true, maxTid: 999 } as never,
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      lastFillAtMs: T0 + 2000,
      seenAtCursor: ["3"],
    });
  });

  // Two fills of one order share a millisecond routinely. Without the identity
  // set at the boundary, one of them is either sent twice or never sent.
  it("does not re-send a fill sharing the cursor's millisecond", () => {
    const first = detectFillEvents({
      user,
      fills: [makeFill({ tid: 10, time: T0 }), makeFill({ tid: 11, time: T0 })],
      state: { initialized: true, lastFillAtMs: T0 - 1, seenAtCursor: [] },
      enabled: true,
    });

    expect(first.events).toHaveLength(2);
    expect(first.state.seenAtCursor.sort()).toEqual(["10", "11"]);

    const second = detectFillEvents({
      user,
      fills: [makeFill({ tid: 10, time: T0 }), makeFill({ tid: 11, time: T0 })],
      state: first.state,
      enabled: true,
    });

    expect(second.events).toEqual([]);
  });

  it("emits a straggler that lands on the cursor's millisecond after the fact", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 10, time: T0 }), makeFill({ tid: 12, time: T0 })],
      state: { initialized: true, lastFillAtMs: T0, seenAtCursor: ["10"] },
      enabled: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.idempotencyKey).toBe("order_fill:0xabc:12");
    expect(result.state.seenAtCursor.sort()).toEqual(["10", "12"]);
  });

  /**
   * `userFills` returns a bounded recent window, so a quiet period can return
   * fewer fills than the cursor was built from. That must not wind the cursor
   * back and re-send everything after it.
   */
  it("never moves the cursor backwards", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 1, time: T0 - 10_000 })],
      state: { initialized: true, lastFillAtMs: T0, seenAtCursor: ["9"] },
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state.lastFillAtMs).toBe(T0);
    expect(result.state.seenAtCursor).toEqual(["9"]);
  });

  it("advances the cursor even when fill notifications are disabled", () => {
    const result = detectFillEvents({
      user,
      fills: [makeFill({ tid: 102, time: T0 + 5000 })],
      state: { initialized: true, lastFillAtMs: T0, seenAtCursor: ["100"] },
      enabled: false,
    });

    // Otherwise turning notifications on delivers the whole quiet period at once.
    expect(result.events).toEqual([]);
    expect(result.state.lastFillAtMs).toBe(T0 + 5000);
  });
});
