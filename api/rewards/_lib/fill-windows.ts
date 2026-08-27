/**
 * Time-window paging over Hyperliquid fills.
 *
 * `userFillsByTime` answers at most 2,000 fills for a window and gives no
 * indication of truncation: a window holding 2,001 fills and a window holding
 * exactly 2,000 return byte-identical-looking responses. Advancing a cursor on
 * a full response therefore drops whatever did not fit, silently and
 * permanently, and the user is simply never paid for those trades.
 *
 * So a full response is treated as "unknown, possibly truncated" and the window
 * is halved until every part answers under the cap. That costs extra requests
 * only for genuinely dense windows, and it is the only way the boundary can be
 * proven rather than assumed.
 */

/** Hyperliquid's per-response cap. A response of exactly this size proves nothing. */
export const FILL_PAGE_LIMIT = 2000;

/**
 * Hyperliquid retains roughly this many fills per account. Past it, the API
 * cannot answer for the whole season no matter how the windows are cut.
 */
export const FILL_HISTORY_LIMIT = 10000;

/** Guards against pathological recursion; 40 halvings takes a month down to milliseconds. */
const MAX_SUBDIVISION_DEPTH = 40;

export interface RawFill {
  /** USDC charged as a builder fee. Exchange-recorded, so it cannot be forged. */
  builderFee?: number | string | null;
  cloid?: string | null;
  hash: string;
  oid: number;
  px: number | string;
  sz: number | string;
  tid: number;
  time: number;
}

export interface FillSummary {
  builderFeeUsd: number;
  cloid: string | null;
  fillKey: string;
  occurredAt: string;
  price: number;
  size: number;
}

/** Inclusive on both ends, in epoch milliseconds. */
export interface FillWindow {
  startMs: number;
  endMs: number;
}

export interface FetchFillWindowResult {
  fills: FillSummary[];
  /**
   * True when some window could not be resolved under the cap even at
   * millisecond width. The fills returned are real, but they are not provably
   * all of them.
   */
  retentionRisk: boolean;
  /** Requests issued, for the run log. Subdivision makes this exceed one. */
  requestCount: number;
}

export type FetchFillsByTime = (window: FillWindow) => Promise<RawFill[]>;

/**
 * A stable identity for a fill.
 *
 * `tid` alone is not enough across the boundary cases this code exists to
 * handle, and the order id alone is shared by every fill of a partially filled
 * order. The triple is what the ledger's idempotency key embeds, so it must
 * stay stable: changing it re-grants XP for every historical fill.
 */
export function toFillKey(fill: RawFill): string {
  return `${fill.tid}:${fill.hash}:${fill.oid}`;
}

export function toFillSummary(fill: RawFill): FillSummary {
  return {
    builderFeeUsd: Number(fill.builderFee ?? 0),
    cloid: fill.cloid ?? null,
    fillKey: toFillKey(fill),
    occurredAt: new Date(fill.time).toISOString(),
    price: Number(fill.px),
    size: Number(fill.sz),
  };
}

/**
 * Every fill in [startMs, endMs], subdividing any window that comes back full.
 *
 * Halves are [start, mid] and [mid + 1, end] so no instant belongs to both;
 * results are still deduplicated by fill key, because a retry or an overlapping
 * boundary must not be able to double-count a fill into a second XP grant.
 */
export async function fetchFillsInWindow(
  fetchFills: FetchFillsByTime,
  window: FillWindow,
): Promise<FetchFillWindowResult> {
  const byKey = new Map<string, FillSummary>();
  let retentionRisk = false;
  let requestCount = 0;

  async function walk(current: FillWindow, depth: number): Promise<void> {
    if (current.startMs > current.endMs) {
      return;
    }

    const raw = await fetchFills(current);
    requestCount += 1;

    if (raw.length >= FILL_PAGE_LIMIT && current.startMs < current.endMs && depth < MAX_SUBDIVISION_DEPTH) {
      // Full, and still splittable: discard this answer and ask for the halves.
      // Keeping it would mean trusting a response that cannot say whether it
      // is complete.
      const mid = current.startMs + Math.floor((current.endMs - current.startMs) / 2);
      await walk({ endMs: mid, startMs: current.startMs }, depth + 1);
      await walk({ endMs: current.endMs, startMs: mid + 1 }, depth + 1);
      return;
    }

    if (raw.length >= FILL_PAGE_LIMIT) {
      // A single millisecond, or the depth guard, still answering a full page.
      // Take what is here and record that completeness is not provable.
      retentionRisk = true;
    }

    for (const fill of raw) {
      const summary = toFillSummary(fill);
      byKey.set(summary.fillKey, summary);
    }
  }

  await walk(window, 0);

  return {
    fills: [...byKey.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    requestCount,
    retentionRisk,
  };
}

/**
 * The next cursor, given a completed window.
 *
 * The window end, not the newest fill's timestamp. Using the newest fill would
 * re-read it forever when a window ends quiet, and — worse — would strand any
 * fill sharing that exact millisecond on the far side of the next window's
 * start. The window was proven complete, so its end is proven ingested.
 */
export function nextCursorMs(window: FillWindow): number {
  return window.endMs;
}
