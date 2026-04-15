import { describe, expect, it, vi } from "vitest";
import { runNotificationWorkerOnce } from "./run-once";
import type {
  EligibleUser,
  MarketDataService,
  NotificationRepository,
  PendingNotificationEvent,
  QueuedNotificationEvent,
  TelegramClient,
} from "./types";

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
  channelStatus: null,
};

function createHarness() {
  const runtimeState = new Map<string, unknown>();
  const pendingEvents: PendingNotificationEvent[] = [];
  const sentTexts: string[] = [];

  const repository: NotificationRepository = {
    listEligibleUsers: vi.fn().mockResolvedValue([user]),
    ensureTelegramChannel: vi.fn(),
    getRuntimeState: (async <T>(
      userId: string,
      stateKey: string,
    ): Promise<T | null> =>
      (runtimeState.get(`${userId}:${stateKey}`) as T | undefined) ?? null) as NotificationRepository["getRuntimeState"],
    setRuntimeState: vi.fn(async (userId: string, stateKey: string, state: unknown) => {
      runtimeState.set(`${userId}:${stateKey}`, state);
    }),
    listSuccessfulDepositOrders: vi.fn().mockResolvedValue([]),
    enqueueEvent: vi.fn(async (event: QueuedNotificationEvent) => {
      pendingEvents.push({
        id: `${pendingEvents.length + 1}`,
        userId: event.userId,
        channel: event.channel,
        topic: event.topic,
        attempts: 0,
        target: user.telegramId,
        language: event.language,
        payload: event.payload,
      });
    }),
    listPendingTelegramEvents: vi.fn(async () => [...pendingEvents]),
    markEventSent: vi.fn(async (eventId: string) => {
      const index = pendingEvents.findIndex((event) => event.id === eventId);
      if (index >= 0) pendingEvents.splice(index, 1);
    }),
    markEventRetry: vi.fn(),
    markEventFailed: vi.fn(),
    updateChannelStatus: vi.fn(),
  };

  const marketData: MarketDataService = {
    getFills: vi
      .fn()
      .mockResolvedValueOnce([
        {
          tid: 100,
          coin: "BTC",
          side: "buy",
          px: 65000,
          sz: 0.1,
          dir: "Open",
          time: 1_710_000_000_000,
          closedPnl: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          tid: 100,
          coin: "BTC",
          side: "buy",
          px: 65000,
          sz: 0.1,
          dir: "Open",
          time: 1_710_000_000_000,
          closedPnl: 0,
        },
        {
          tid: 101,
          coin: "BTC",
          side: "sell",
          px: 64500,
          sz: 0.1,
          dir: "Close",
          time: 1_710_000_060_000,
          closedPnl: 25,
        },
      ]),
    getPositions: vi.fn().mockResolvedValue([
      {
        coin: "BTC",
        szi: 1,
        entryPx: 120,
        liquidationPx: 100,
      },
    ]),
    getMids: vi
      .fn()
      .mockResolvedValueOnce({ BTC: 108 })
      .mockResolvedValueOnce({ BTC: 104 }),
  };

  const telegram: TelegramClient = {
    sendMessage: vi.fn(async ({ text }) => {
      sentTexts.push(text);
      return { ok: true };
    }),
  };

  return { repository, marketData, telegram, sentTexts, pendingEvents };
}

describe("runNotificationWorkerOnce", () => {
  it("seeds runtime state on first scan, then emits and sends new events on the next scan", async () => {
    const harness = createHarness();

    await runNotificationWorkerOnce({
      repository: harness.repository,
      marketData: harness.marketData,
      telegram: harness.telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(harness.repository.ensureTelegramChannel).toHaveBeenCalledWith(
      "user-1",
      "123",
    );
    expect(harness.repository.enqueueEvent).not.toHaveBeenCalled();
    expect(harness.sentTexts).toEqual([]);

    await runNotificationWorkerOnce({
      repository: harness.repository,
      marketData: harness.marketData,
      telegram: harness.telegram,
      now: new Date("2026-04-14T12:01:00.000Z"),
    });

    expect(harness.repository.enqueueEvent).toHaveBeenCalledTimes(2);
    expect(harness.sentTexts).toHaveLength(2);
    expect(harness.sentTexts[0]).toContain("Order fill");
    expect(harness.sentTexts[1]).toContain("Liquidation risk");
    expect(harness.pendingEvents).toEqual([]);
  });
});
