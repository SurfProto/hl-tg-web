import type {
  EligibleUser,
  PriceAlert,
  QueuedNotificationEvent,
} from "./types";

interface DetectPriceAlertEventsArgs {
  user: EligibleUser;
  alerts: PriceAlert[];
  midsByCoin: Record<string, number>;
}

interface DetectPriceAlertEventsResult {
  events: QueuedNotificationEvent[];
  /** Alerts consumed by this scan; the caller marks them triggered. */
  triggeredAlertIds: string[];
}

/**
 * One-shot level crossings. No stored state and no episodes, unlike the
 * liquidation detector: the alert row itself is the arming, and the event's
 * idempotency key is the alert id — so a crash between enqueue and the
 * triggered-mark replays into a dedupe, never a second message.
 *
 * "Crossed" is level-touched, not level-passed-through: an alert above at
 * 110,000 fires when the mid is at or beyond it on this scan. A gap straight
 * through the level between scans still fires, which is the whole point of an
 * alert over a chart.
 */
export function detectPriceAlertEvents({
  user,
  alerts,
  midsByCoin,
}: DetectPriceAlertEventsArgs): DetectPriceAlertEventsResult {
  const events: QueuedNotificationEvent[] = [];
  const triggeredAlertIds: string[] = [];

  for (const alert of alerts) {
    const markPx = midsByCoin[alert.coin];
    if (!markPx || markPx <= 0) {
      continue;
    }

    const crossed =
      alert.direction === "above"
        ? markPx >= alert.targetPx
        : markPx <= alert.targetPx;
    if (!crossed) {
      continue;
    }

    triggeredAlertIds.push(alert.id);
    events.push({
      userId: user.userId,
      channel: "telegram",
      topic: "price_alert",
      idempotencyKey: `price_alert:${alert.id}`,
      language: user.language,
      payload: {
        coin: alert.coin,
        direction: alert.direction,
        markPx,
        targetPx: alert.targetPx,
        language: user.language,
      },
    });
  }

  return { events, triggeredAlertIds };
}
