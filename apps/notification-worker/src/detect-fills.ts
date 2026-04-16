import type { EligibleUser, FillRecord, QueuedNotificationEvent } from "./types";

interface FillCursorState {
  initialized: boolean;
  maxTid: number | null;
}

interface DetectFillEventsArgs {
  user: EligibleUser;
  fills: FillRecord[];
  state: FillCursorState | null;
  enabled: boolean;
}

interface DetectFillEventsResult {
  events: QueuedNotificationEvent[];
  state: FillCursorState;
}

export function detectFillEvents({
  user,
  fills,
  state,
  enabled,
}: DetectFillEventsArgs): DetectFillEventsResult {
  const sortedFills = [...fills].sort((left, right) => left.tid - right.tid);
  const maxTid =
    sortedFills.length > 0 ? sortedFills[sortedFills.length - 1].tid : null;

  if (!state?.initialized) {
    return {
      events: [],
      state: {
        initialized: true,
        maxTid,
      },
    };
  }

  const events = enabled
    ? sortedFills
        .filter((fill) => state.maxTid == null || fill.tid > state.maxTid)
        .map<QueuedNotificationEvent>((fill) => ({
          userId: user.userId,
          channel: "telegram",
          topic: "order_fill",
          idempotencyKey: `order_fill:${user.walletAddress}:${fill.tid}`,
          language: user.language,
          payload: {
            ...fill,
            language: user.language,
          },
        }))
    : [];

  return {
    events,
    state: {
      initialized: true,
      maxTid: maxTid ?? state.maxTid,
    },
  };
}
