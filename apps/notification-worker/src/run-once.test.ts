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
  channelTarget: null,
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
    claimPendingTelegramEvents: vi.fn(async () => [...pendingEvents]),
    markEventSent: vi.fn(async (eventId: string) => {
      const index = pendingEvents.findIndex((event) => event.id === eventId);
      if (index >= 0) pendingEvents.splice(index, 1);
    }),
    markEventRetry: vi.fn(),
    markEventFailed: vi.fn(),
    recordChannelDelivery: vi.fn(),
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

  /**
   * One account's failure must not starve the accounts behind it. This used
   * to crash the process, and systemd restarted it into the same user in the
   * same list order — so everyone after the failing account got no detection,
   * and delivery, which runs after the loop, never ran for anyone.
   */
  it("keeps scanning the remaining users when one account's detection throws", async () => {
    const userA = { ...user, userId: "user-a", walletAddress: "0xaaa" };
    const userB = { ...user, userId: "user-b", walletAddress: "0xbbb" };
    const stateWrites: string[] = [];

    const repository: NotificationRepository = {
      listEligibleUsers: vi.fn().mockResolvedValue([userA, userB]),
      ensureTelegramChannel: vi.fn(),
      getRuntimeState: (async () => null) as NotificationRepository["getRuntimeState"],
      setRuntimeState: vi.fn(async (userId: string) => {
        stateWrites.push(userId);
      }),
      listSuccessfulDepositOrders: vi.fn().mockResolvedValue([]),
      enqueueEvent: vi.fn(),
      claimPendingTelegramEvents: vi.fn(async () => []),
      markEventSent: vi.fn(),
      markEventRetry: vi.fn(),
      markEventFailed: vi.fn(),
      recordChannelDelivery: vi.fn(),
      updateChannelStatus: vi.fn(),
    };
    const marketData: MarketDataService = {
      getFills: vi.fn(async (wallet: string) => {
        if (wallet === "0xaaa") throw new Error("hyperliquid 500");
        return [];
      }),
      getPositions: vi.fn().mockResolvedValue([]),
      getMids: vi.fn().mockResolvedValue({}),
    };
    const telegram: TelegramClient = {
      sendMessage: vi.fn(async () => ({ ok: true })),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runNotificationWorkerOnce({
      repository,
      marketData,
      telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(stateWrites).toContain("user-b");
    expect(stateWrites).not.toContain("user-a");
    expect(repository.claimPendingTelegramEvents).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  /**
   * The channel row used to be written once and never updated, so after a user
   * linked a different Telegram account their fills and liquidation alerts
   * kept going to the previous chat — someone else's, possibly.
   */
  it("re-points the channel only when the linked Telegram account changed", async () => {
    const current = { ...user, userId: "user-current", channelTarget: "123" };
    const relinked = {
      ...user,
      userId: "user-relinked",
      telegramId: "999",
      channelTarget: "123",
    };

    const repository: NotificationRepository = {
      listEligibleUsers: vi.fn().mockResolvedValue([current, relinked]),
      ensureTelegramChannel: vi.fn(),
      getRuntimeState: (async () => null) as NotificationRepository["getRuntimeState"],
      setRuntimeState: vi.fn(),
      listSuccessfulDepositOrders: vi.fn().mockResolvedValue([]),
      enqueueEvent: vi.fn(),
      claimPendingTelegramEvents: vi.fn(async () => []),
      markEventSent: vi.fn(),
      markEventRetry: vi.fn(),
      markEventFailed: vi.fn(),
      recordChannelDelivery: vi.fn(),
      updateChannelStatus: vi.fn(),
    };
    const marketData: MarketDataService = {
      getFills: vi.fn().mockResolvedValue([]),
      getPositions: vi.fn().mockResolvedValue([]),
      getMids: vi.fn().mockResolvedValue({}),
    };
    const telegram: TelegramClient = {
      sendMessage: vi.fn(async () => ({ ok: true })),
    };

    await runNotificationWorkerOnce({
      repository,
      marketData,
      telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(repository.ensureTelegramChannel).toHaveBeenCalledTimes(1);
    expect(repository.ensureTelegramChannel).toHaveBeenCalledWith(
      "user-relinked",
      "999",
    );
  });
});
