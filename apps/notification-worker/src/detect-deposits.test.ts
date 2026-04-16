import { describe, expect, it } from "vitest";
import { detectDepositEvents } from "./detect-deposits";
import type { EligibleUser, SuccessfulDepositOrder } from "./types";

const user: EligibleUser = {
  userId: "user-1",
  walletAddress: "0xabc",
  telegramId: "123",
  language: "ru",
  preferences: {
    liquidation_alerts: true,
    order_fills: true,
    usdc_deposits: true,
  },
  channelStatus: "active",
};

function makeOrder(
  partial: Partial<SuccessfulDepositOrder> = {},
): SuccessfulDepositOrder {
  return {
    providerOrderId: "ord-1",
    payoutAmount: "150",
    payoutCurrency: "USDT",
    lastSyncedAt: "2026-04-14T10:00:00.000Z",
    ...partial,
  };
}

describe("detectDepositEvents", () => {
  it("seeds the known success set on first scan without backfilling alerts", () => {
    const result = detectDepositEvents({
      user,
      orders: [makeOrder({ providerOrderId: "ord-1" })],
      state: null,
      enabled: true,
    });

    expect(result.events).toEqual([]);
    expect(result.state).toEqual({
      initialized: true,
      seenProviderOrderIds: ["ord-1"],
    });
  });

  it("emits newly successful deposit orders once", () => {
    const result = detectDepositEvents({
      user,
      orders: [makeOrder({ providerOrderId: "ord-1" }), makeOrder({ providerOrderId: "ord-2" })],
      state: { initialized: true, seenProviderOrderIds: ["ord-1"] },
      enabled: true,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      topic: "usdc_deposit",
      idempotencyKey: "usdc_deposit:user-1:ord-2:success",
      payload: expect.objectContaining({
        providerOrderId: "ord-2",
        language: "ru",
      }),
    });
    expect(result.state).toEqual({
      initialized: true,
      seenProviderOrderIds: ["ord-1", "ord-2"],
    });
  });
});
