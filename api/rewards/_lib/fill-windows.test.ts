import { describe, expect, it, vi } from "vitest";
import {
  FILL_PAGE_LIMIT,
  fetchFillsInWindow,
  nextCursorMs,
  toFillKey,
  type FillWindow,
  type RawFill,
} from "./fill-windows";

function fill(timeMs: number, id: number): RawFill {
  return {
    cloid: "0x1a17deadbeef",
    hash: `0xhash${id}`,
    oid: id,
    px: 100,
    sz: 1,
    tid: id,
    time: timeMs,
  };
}

/**
 * A fake exchange holding a fixed set of fills.
 *
 * Answers inclusively on both ends and truncates to the page limit oldest-first,
 * which is the behaviour that makes a full response ambiguous.
 */
function fakeExchange(all: RawFill[]) {
  const calls: FillWindow[] = [];
  const fetchFills = vi.fn(async (window: FillWindow) => {
    calls.push({ ...window });
    return all
      .filter((f) => f.time >= window.startMs && f.time <= window.endMs)
      .sort((a, b) => a.time - b.time)
      .slice(0, FILL_PAGE_LIMIT);
  });
  return { calls, fetchFills };
}

describe("fill window paging", () => {
  it("returns everything in a window that fits under the cap", async () => {
    const { fetchFills } = fakeExchange([fill(10, 1), fill(20, 2), fill(30, 3)]);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 100, startMs: 0 });

    expect(result.fills.map((f) => f.fillKey)).toEqual(["1:0xhash1:1", "2:0xhash2:2", "3:0xhash3:3"]);
    expect(result.requestCount).toBe(1);
    expect(result.retentionRisk).toBe(false);
  });

  /**
   * The defect this module exists for.
   *
   * 2,500 fills in one window: the exchange answers 2,000 and says nothing
   * about the remaining 500. Advancing the cursor on that response loses them
   * permanently, and the user is never paid for those trades.
   */
  it("does not drop fills past the page cap", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => fill(1_000 + i, i + 1));
    const { fetchFills } = fakeExchange(all);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 10_000, startMs: 0 });

    expect(result.fills).toHaveLength(2500);
    expect(result.retentionRisk).toBe(false);
    expect(result.requestCount).toBeGreaterThan(1);
  });

  /**
   * Exactly 2,000 is the genuinely ambiguous case: complete, but
   * indistinguishable from truncated. Subdividing must confirm it rather than
   * assume either way.
   */
  it("resolves a window holding exactly the page limit", async () => {
    const all = Array.from({ length: FILL_PAGE_LIMIT }, (_, i) => fill(1_000 + i, i + 1));
    const { fetchFills } = fakeExchange(all);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 10_000, startMs: 0 });

    expect(result.fills).toHaveLength(FILL_PAGE_LIMIT);
    expect(result.requestCount).toBeGreaterThan(1);
    expect(result.retentionRisk).toBe(false);
  });

  // Halves are [start, mid] and [mid + 1, end], so no instant is fetched twice
  // — but a fill must not be double counted even if it were.
  it("never returns the same fill twice", async () => {
    const all = Array.from({ length: 3000 }, (_, i) => fill(1_000 + i, i + 1));
    const { fetchFills } = fakeExchange(all);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 10_000, startMs: 0 });

    expect(new Set(result.fills.map((f) => f.fillKey)).size).toBe(result.fills.length);
  });

  it("covers windows without gaps when it subdivides", async () => {
    const { calls, fetchFills } = fakeExchange(
      Array.from({ length: 2400 }, (_, i) => fill(1_000 + i, i + 1)),
    );

    await fetchFillsInWindow(fetchFills, { endMs: 4_000, startMs: 0 });

    // Every leaf window that was actually answered, in order, must tile the
    // original range: each starts exactly one millisecond after the last ended.
    const leaves = calls
      .filter((c) => !calls.some((o) => o !== c && o.startMs >= c.startMs && o.endMs <= c.endMs && (o.startMs !== c.startMs || o.endMs !== c.endMs)))
      .sort((a, b) => a.startMs - b.startMs);

    expect(leaves[0]!.startMs).toBe(0);
    expect(leaves.at(-1)!.endMs).toBe(4_000);
    for (let i = 1; i < leaves.length; i += 1) {
      expect(leaves[i]!.startMs).toBe(leaves[i - 1]!.endMs + 1);
    }
  });

  /**
   * Denser than the API can express: more than the page limit inside a single
   * millisecond. The fills returned are real, but they are not provably all of
   * them, and reconciliation has to know that.
   */
  it("flags retention risk when a minimal window is still full", async () => {
    const all = Array.from({ length: 2100 }, (_, i) => fill(5_000, i + 1));
    const { fetchFills } = fakeExchange(all);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 9_000, startMs: 0 });

    expect(result.retentionRisk).toBe(true);
    expect(result.fills).toHaveLength(FILL_PAGE_LIMIT);
  });

  it("issues no request for an inverted window", async () => {
    const { fetchFills } = fakeExchange([fill(10, 1)]);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 5, startMs: 10 });

    expect(fetchFills).not.toHaveBeenCalled();
    expect(result.fills).toEqual([]);
  });

  it("handles an empty window", async () => {
    const { fetchFills } = fakeExchange([]);

    const result = await fetchFillsInWindow(fetchFills, { endMs: 100, startMs: 0 });

    expect(result.fills).toEqual([]);
    expect(result.retentionRisk).toBe(false);
  });
});

describe("fill identity", () => {
  /**
   * The ledger's idempotency key embeds this string. Changing its shape
   * re-grants XP for every fill already recorded, so it is pinned here
   * deliberately rather than left to drift.
   */
  it("is the tid:hash:oid triple", () => {
    expect(toFillKey(fill(1, 7))).toBe("7:0xhash7:7");
  });

  it("distinguishes fills of one partially filled order", () => {
    const a: RawFill = { hash: "0xsame", oid: 99, px: 1, sz: 1, tid: 1, time: 1 };
    const b: RawFill = { hash: "0xsame", oid: 99, px: 1, sz: 1, tid: 2, time: 1 };

    expect(toFillKey(a)).not.toBe(toFillKey(b));
  });
});

describe("cursor advance", () => {
  /**
   * The window end, not the newest fill. Using the newest fill would re-read it
   * forever when a window ends quiet, and would strand any fill sharing that
   * millisecond behind the next window's start.
   */
  it("advances to the proven end of the window", () => {
    expect(nextCursorMs({ endMs: 9_000, startMs: 1_000 })).toBe(9_000);
  });
});
