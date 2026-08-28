import type { EligibleUser, FillRecord, QueuedNotificationEvent } from "./types";

/**
 * New fills since the last run.
 *
 * The cursor is the newest fill's *timestamp*. It used to be the highest `tid`,
 * on the assumption that Hyperliquid hands them out in order. It does not —
 * `tid` is a hash-like identifier, and the live data says so plainly: a fill on
 * 23 August carried tid 865817447693567 while one on 24 August carried
 * 35167167033945, twenty-five times smaller.
 *
 * So `fill.tid > state.maxTid` was false for essentially every fill after the
 * account happened to record its single largest id. On the first production
 * account that was in April; it traded 109 times afterwards and was told about
 * none of them. The failure is silent by construction — nothing errors, the
 * worker runs every minute, the state row updates, and no notification is ever
 * sent again.
 *
 * Time is the ordering the exchange actually guarantees, so the cursor is a
 * time, with the fills sharing that exact millisecond remembered by identity.
 * A cursor of "newest instant seen" alone would either re-send a fill that
 * shared the boundary millisecond or drop it, depending on which way the
 * comparison went; keeping the identities at the boundary is what makes it
 * exactly-once.
 */
export interface FillCursorState {
  initialized: boolean;
  /** Epoch milliseconds of the newest fill already reported. */
  lastFillAtMs: number | null;
  /** Fill ids at exactly `lastFillAtMs`, so the boundary is neither re-sent nor lost. */
  seenAtCursor: string[];
  /**
   * The old high-water mark. Read but never written: its presence without
   * `lastFillAtMs` is how a state row written by the previous version is
   * recognised. See `rebaselined` below.
   */
  maxTid?: number | null;
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

function fillId(fill: FillRecord): string {
  return String(fill.tid);
}

/** The cursor implied by a window of fills: newest instant, and who was on it. */
function cursorFor(fills: FillRecord[]): { lastFillAtMs: number | null; seenAtCursor: string[] } {
  if (fills.length === 0) {
    return { lastFillAtMs: null, seenAtCursor: [] };
  }

  const lastFillAtMs = Math.max(...fills.map((fill) => fill.time));
  return {
    lastFillAtMs,
    seenAtCursor: fills.filter((fill) => fill.time === lastFillAtMs).map(fillId),
  };
}

export function detectFillEvents({
  user,
  fills,
  state,
  enabled,
}: DetectFillEventsArgs): DetectFillEventsResult {
  const sortedFills = [...fills].sort((left, right) => left.time - right.time);

  // A brand new account, or one whose state predates the time cursor. Both
  // adopt the current window as the baseline and report nothing.
  //
  // The second case matters: an account carrying the old `maxTid` state has a
  // backlog of every fill since its notifications quietly stopped — 109 of them
  // on the first production account. Replaying that as a re-baseline would send
  // the whole backlog as individual messages, which is a worse failure than the
  // silence it replaces.
  const rebaselined = state?.initialized === true && state.lastFillAtMs == null;

  if (!state?.initialized || rebaselined) {
    return {
      events: [],
      state: { initialized: true, ...cursorFor(sortedFills) },
    };
  }

  const cursorMs = state.lastFillAtMs ?? 0;
  const seenAtCursor = new Set(state.seenAtCursor ?? []);

  const newFills = sortedFills.filter((fill) => {
    if (fill.time > cursorMs) {
      return true;
    }

    // Exactly on the boundary: new only if it was not one of the fills the
    // cursor was set from.
    return fill.time === cursorMs && !seenAtCursor.has(fillId(fill));
  });

  const events = enabled
    ? newFills.map<QueuedNotificationEvent>((fill) => ({
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

  // Advanced from everything observed, not only from what was sent. A user with
  // fills disabled must not accumulate a backlog that arrives all at once when
  // they turn them on.
  const next = cursorFor(sortedFills);

  return {
    events,
    state: {
      initialized: true,
      // Never backwards: `userFills` returns a bounded recent window, so a
      // quiet period can return fewer fills than the cursor was built from.
      lastFillAtMs:
        next.lastFillAtMs != null && next.lastFillAtMs >= cursorMs
          ? next.lastFillAtMs
          : cursorMs,
      seenAtCursor:
        next.lastFillAtMs != null && next.lastFillAtMs > cursorMs
          ? next.seenAtCursor
          : next.lastFillAtMs === cursorMs
            ? [...new Set([...seenAtCursor, ...next.seenAtCursor])]
            : [...seenAtCursor],
    },
  };
}
