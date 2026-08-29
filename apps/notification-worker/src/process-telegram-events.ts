import { buildTelegramMessage } from "./message-format";
import type {
  NotificationRepository,
  PendingNotificationEvent,
  TelegramClient,
  TelegramSendResult,
} from "./types";

interface ProcessTelegramEventsArgs {
  events: PendingNotificationEvent[];
  repository: NotificationRepository;
  telegram: TelegramClient;
  now: Date;
}

const MAX_ATTEMPTS = 10;

function getRetryDate(now: Date, retryAfterSeconds?: number): Date {
  const seconds = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : 60;
  return new Date(now.getTime() + seconds * 1000);
}

export async function processTelegramEvents({
  events,
  repository,
  telegram,
  now,
}: ProcessTelegramEventsArgs): Promise<void> {
  for (const event of events) {
    // A thrown send (network down, DNS failure) is as retryable as a 5xx.
    // Uncaught it left the loop, so one flaky request stalled every pending
    // event behind it and crashed the process.
    let result: TelegramSendResult;
    try {
      result = await telegram.sendMessage({
        target: event.target,
        text: buildTelegramMessage(event),
      });
    } catch (error) {
      result = {
        ok: false,
        description:
          error instanceof Error ? error.message : "Telegram send threw",
      };
    }

    if (result.ok) {
      await repository.markEventSent(event.id);
      // The channel is what the health surface reads, and a delivery is the
      // strongest evidence it works. Marking only the event left that surface
      // reporting "never delivered" for a channel that was delivering.
      await repository.recordChannelDelivery(event.userId);
      continue;
    }

    const errorCode = `telegram_${result.code ?? "unknown"}`;
    const errorMessage = result.description ?? "Telegram send failed";

    if (result.code === 403) {
      await repository.markEventFailed(event.id, errorCode, errorMessage);
      await repository.updateChannelStatus(
        event.userId,
        "blocked",
        errorCode,
        errorMessage,
      );
      continue;
    }

    if (result.code === 400) {
      await repository.markEventFailed(event.id, errorCode, errorMessage);
      await repository.updateChannelStatus(
        event.userId,
        "invalid",
        errorCode,
        errorMessage,
      );
      continue;
    }

    if (event.attempts >= MAX_ATTEMPTS) {
      await repository.markEventFailed(event.id, errorCode, errorMessage);
      continue;
    }

    await repository.markEventRetry(
      event.id,
      getRetryDate(now, result.retryAfterSeconds),
      errorCode,
      errorMessage,
    );
  }
}
