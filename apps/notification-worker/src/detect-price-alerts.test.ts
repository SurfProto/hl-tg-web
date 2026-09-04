import { describe, expect, it } from "vitest";
import { detectPriceAlertEvents } from "./detect-price-alerts";
import type { EligibleUser, PriceAlert } from "./types";

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

function alert(partial: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: "alert-1",
    coin: "BTC",
    targetPx: 110_000,
    direction: "above",
    ...partial,
  };
}

describe("detectPriceAlertEvents", () => {
  it("fires when the mid reaches an above-level, and consumes the alert", () => {
    const result = detectPriceAlertEvents({
      user,
      alerts: [alert()],
      midsByCoin: { BTC: 110_500 },
    });

    expect(result.triggeredAlertIds).toEqual(["alert-1"]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      topic: "price_alert",
      // The alert id is the whole idempotency story: one-shot rows need no
      // episodes, and replays after a crash dedupe against this key.
      idempotencyKey: "price_alert:alert-1",
      payload: expect.objectContaining({
        coin: "BTC",
        direction: "above",
        markPx: 110_500,
        targetPx: 110_000,
      }),
    });
  });

  it("fires a below-level the same way", () => {
    const result = detectPriceAlertEvents({
      user,
      alerts: [alert({ id: "alert-2", direction: "below", targetPx: 100_000 })],
      midsByCoin: { BTC: 99_800 },
    });

    expect(result.triggeredAlertIds).toEqual(["alert-2"]);
  });

  it("leaves an uncrossed alert armed", () => {
    const result = detectPriceAlertEvents({
      user,
      alerts: [alert()],
      midsByCoin: { BTC: 109_000 },
    });

    expect(result.events).toEqual([]);
    expect(result.triggeredAlertIds).toEqual([]);
  });

  it("skips an alert whose coin has no mid, leaving it armed", () => {
    const result = detectPriceAlertEvents({
      user,
      alerts: [alert({ coin: "dex:NEWCOIN" })],
      midsByCoin: { BTC: 110_500 },
    });

    expect(result.events).toEqual([]);
    expect(result.triggeredAlertIds).toEqual([]);
  });

  it("touching the level exactly counts as crossed", () => {
    const result = detectPriceAlertEvents({
      user,
      alerts: [alert()],
      midsByCoin: { BTC: 110_000 },
    });

    expect(result.triggeredAlertIds).toEqual(["alert-1"]);
  });
});
