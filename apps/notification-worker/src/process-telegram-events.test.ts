import { describe, expect, it, vi } from "vitest";
import { processTelegramEvents } from "./process-telegram-events";
import type {
  PendingNotificationEvent,
  TelegramClient,
  NotificationRepository,
} from "./types";

function makeEvent(
  partial: Partial<PendingNotificationEvent> = {},
): PendingNotificationEvent {
  return {
    id: "event-1",
    userId: "user-1",
    channel: "telegram",
    topic: "order_fill",
    attempts: 0,
    target: "123",
    language: "en",
    payload: {
      coin: "BTC",
      side: "buy",
      sz: 0.1,
      px: 65000,
      dir: "Open",
      time: 1_710_000_000_000,
    },
    ...partial,
  };
}

function makeRepository(): NotificationRepository {
  return {
    listEligibleUsers: vi.fn(),
    ensureTelegramChannel: vi.fn(),
    getRuntimeState: vi.fn(),
    setRuntimeState: vi.fn(),
    listSuccessfulDepositOrders: vi.fn(),
    enqueueEvent: vi.fn(),
    listPendingTelegramEvents: vi.fn(),
    markEventSent: vi.fn(),
    markEventRetry: vi.fn(),
    markEventFailed: vi.fn(),
    updateChannelStatus: vi.fn(),
  };
}

describe("processTelegramEvents", () => {
  it("marks successful sends as sent", async () => {
    const repository = makeRepository();
    const telegram: TelegramClient = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    };

    await processTelegramEvents({
      events: [makeEvent()],
      repository,
      telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(telegram.sendMessage).toHaveBeenCalledOnce();
    expect(repository.markEventSent).toHaveBeenCalledWith("event-1");
    expect(repository.markEventRetry).not.toHaveBeenCalled();
  });

  it("retries rate-limited sends with backoff", async () => {
    const repository = makeRepository();
    const telegram: TelegramClient = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        code: 429,
        description: "Too Many Requests",
        retryAfterSeconds: 42,
      }),
    };

    await processTelegramEvents({
      events: [makeEvent()],
      repository,
      telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(repository.markEventRetry).toHaveBeenCalledWith(
      "event-1",
      new Date("2026-04-14T12:00:42.000Z"),
      "telegram_429",
      "Too Many Requests",
    );
    expect(repository.updateChannelStatus).not.toHaveBeenCalled();
  });

  it("marks retryable failures as failed after the max attempt threshold", async () => {
    const repository = makeRepository();
    const telegram: TelegramClient = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        code: 429,
        description: "Too Many Requests",
        retryAfterSeconds: 42,
      }),
    };

    await processTelegramEvents({
      events: [makeEvent({ attempts: 10 })],
      repository,
      telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(repository.markEventFailed).toHaveBeenCalledWith(
      "event-1",
      "telegram_429",
      "Too Many Requests",
    );
    expect(repository.markEventRetry).not.toHaveBeenCalled();
    expect(repository.updateChannelStatus).not.toHaveBeenCalled();
  });

  it("marks blocked chats as failed and updates channel health", async () => {
    const repository = makeRepository();
    const telegram: TelegramClient = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
    };

    await processTelegramEvents({
      events: [makeEvent()],
      repository,
      telegram,
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(repository.markEventFailed).toHaveBeenCalledWith(
      "event-1",
      "telegram_403",
      "Forbidden: bot was blocked by the user",
    );
    expect(repository.updateChannelStatus).toHaveBeenCalledWith(
      "user-1",
      "blocked",
      "telegram_403",
      "Forbidden: bot was blocked by the user",
    );
  });
});
