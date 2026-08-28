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
   * The old high-water mark. Still written, and it must stay written.
   *
   * Its absence is how a row from the previous version is recognised, but that
   * is only half the story: the previous version reads this field too, and its
   * guard was `state.maxTid == null || fill.tid > state.maxTid`. Handed a row
   * without it, that code concludes there is no cursor and emits the entire
   * window.
   *
   * Which is exactly what happened. During the deployment swap a new instance
   * wrote the new shape, an old instance still in flight read it, and one user
   * received 108 order-fill messages in a second. Rolling back would do it
   * again. So the field is kept, populated as the old code would have populated
   * it, and a reader of either version finds a cursor it understands.
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
  /** Events suppressed by the burst cap, for the run log. */
  dropped: number;
  state: FillCursorState;
}

/**
 * The most fill notifications one account may be sent from a single run.
 *
 * A backstop, not a business rule. No plausible minute of trading produces
 * twenty fills that a person wants twenty messages about, and every way this
 * detector can go wrong — a cursor that resets, a state shape a reader does not
 * understand, an exchange window that widens — turns into the same incident: a
 * user's phone buzzing a hundred times. One did, for 108 fills, which is what
 * this exists to make impossible rather than merely unlikely.
 *
 * The newest are kept, because the newest are the ones worth telling somebody
 * about, and the cursor still advances past all of them so the remainder are
 * dropped rather than redelivered next run.
 */
const MAX_EVENTS_PER_RUN = 20;

function fillId(fill: FillRecord): string {
  return String(fill.tid);
}

/**
 * The cursor implied by a window of fills.
 *
 * `maxTid` is carried for the previous version of this code, which reads it and
 * treats its absence as "send everything". See the field's comment.
 */
function cursorFor(fills: FillRecord[]): {
  lastFillAtMs: number | null;
  maxTid: number | null;
  seenAtCursor: string[];
} {
  if (fills.length === 0) {
    return { lastFillAtMs: null, maxTid: null, seenAtCursor: [] };
  }

  const lastFillAtMs = Math.max(...fills.map((fill) => fill.time));
  return {
    lastFillAtMs,
    maxTid: Math.max(...fills.map((fill) => fill.tid)),
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
      dropped: 0,
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

  // Newest kept: those are the ones worth telling somebody about, and the
  // cursor advances past the rest either way.
  const sendable = newFills.slice(-MAX_EVENTS_PER_RUN);

  const events = enabled
    ? sendable.map<QueuedNotificationEvent>((fill) => ({
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
    dropped: enabled ? newFills.length - sendable.length : 0,
    events,
    state: {
      initialized: true,
      // Kept for the previous version of this code, which reads it.
      maxTid:
        next.maxTid != null && state.maxTid != null
          ? Math.max(next.maxTid, state.maxTid)
          : (next.maxTid ?? state.maxTid ?? null),
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
