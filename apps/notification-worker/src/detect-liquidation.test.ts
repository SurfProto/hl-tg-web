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
  channelTarget: "123",
};

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

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
      nowIso: T1,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {
        "BTC|long": [10],
      },
      episodeStartByPosition: {
        "BTC|long": T1,
      },
    });
  });

  it("emits the next newly crossed band as risk worsens", () => {
    // State without episodeStartByPosition is what the worker wrote before
    // episodes existed — the fallback stamps the scan time mid-episode.
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
      nowIso: T2,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      topic: "liquidation_risk",
      idempotencyKey: `liquidation_risk:0xabc:BTC|long:5:${T2}`,
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
      episodeStartByPosition: {
        "BTC|long": T2,
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
        episodeStartByPosition: {
          "BTC|long": T1,
        },
      },
      enabled: true,
      nowIso: T2,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {
        "BTC|long": [],
      },
      episodeStartByPosition: {},
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
        episodeStartByPosition: {
          "BTC|long": T1,
        },
      },
      enabled: true,
      nowIso: T2,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      activeBandsByPosition: {},
      episodeStartByPosition: {},
    });
  });

  /**
   * The regression. Events are deduplicated against a permanently-unique
   * idempotency column, and the key used to carry no episode — so each band
   * was a once-per-lifetime alert: recover, come back months later, drift
   * toward liquidation again, and the enqueue was silently dropped.
   */
  it("re-alerts when danger returns after a full recovery", () => {
    const safe = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 150 },
      state: null,
      enabled: true,
      nowIso: T1,
    });

    const firstDanger = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 108 },
      state: safe.state,
      enabled: true,
      nowIso: T1,
    });
    expect(firstDanger.events).toHaveLength(1);

    const recovered = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 150 },
      state: firstDanger.state,
      enabled: true,
      nowIso: T2,
    });
    expect(recovered.events).toEqual([]);

    const secondDanger = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 108 },
      state: recovered.state,
      enabled: true,
      nowIso: T3,
    });
    expect(secondDanger.events).toHaveLength(1);
    expect(secondDanger.events[0].idempotencyKey).not.toBe(
      firstDanger.events[0].idempotencyKey,
    );
  });

  it("keeps one key per band within an episode, so oscillation cannot spam", () => {
    // In bands [10, 5] since T1; price eases out of 5 and drops back in.
    const eased = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 108 },
      state: {
        initialized: true,
        activeBandsByPosition: { "BTC|long": [10, 5] },
        episodeStartByPosition: { "BTC|long": T1 },
      },
      enabled: true,
      nowIso: T2,
    });
    expect(eased.events).toEqual([]);

    const backIn = detectLiquidationEvents({
      user,
      positions: [makePosition()],
      midsByCoin: { BTC: 104 },
      state: eased.state,
      enabled: true,
      nowIso: T3,
    });
    expect(backIn.events).toHaveLength(1);
    // Same episode, same band, same key — the enqueue layer deduplicates it.
    expect(backIn.events[0].idempotencyKey).toBe(
      `liquidation_risk:0xabc:BTC|long:5:${T1}`,
    );
  });
});
