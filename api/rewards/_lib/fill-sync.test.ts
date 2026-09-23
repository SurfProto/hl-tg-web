import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILL_PAGE_LIMIT, type FillWindow, type RawFill } from "./fill-windows";

const supabaseAdmin = vi.hoisted(() => ({
  completeFillSync: vi.fn(),
  getFundedReferralStats: vi.fn(),
  getGrantedQuestIds: vi.fn(),
  getLargestTradeUsd: vi.fn(),
  getQualifyingDeposits: vi.fn(),
  getUserById: vi.fn(),
  upsertRewardLedgerEntries: vi.fn(),
}));

vi.mock("./supabase-admin", () => supabaseAdmin);

import { syncAccountFills } from "./fill-sync";

const SEASON_START = "2026-08-01T00:00:00.000Z";
// Seasons are half-open; this is the first instant of the next one.
const SEASON_END = "2026-09-01T00:00:00.000Z";

function config() {
  return {
    firstTradeThresholdUsd: 10,
    fundedDepositThresholdUsd: 50,
    xpPerUsd: 1,
  } as never;
}

function claim(overrides: Record<string, unknown> = {}) {
  return {
    checkpointId: "cp-1",
    cursorTime: SEASON_START,
    fillsIngested: 0,
    seasonId: "season-1",
    userId: "user-1",
    walletAddress: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
    ...overrides,
  } as never;
}

/** App-attributed: only fills carrying the app's cloid prefix earn XP. */
function appFill(timeMs: number, id: number, notional = 100): RawFill {
  return {
    // The exchange-recorded builder fee is what makes a fill ours. The cloid is
    // kept only as supporting evidence.
    builderFee: notional * 0.0001,
    cloid: "0x1a17000000000000",
    hash: `0xhash${id}`,
    oid: id,
    px: notional,
    sz: 1,
    tid: id,
    time: timeMs,
  };
}

const NOW = Date.parse("2026-08-02T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  supabaseAdmin.getQualifyingDeposits.mockResolvedValue([]);
  supabaseAdmin.getGrantedQuestIds.mockResolvedValue([]);
  supabaseAdmin.getFundedReferralStats.mockResolvedValue({
    fundedReferralCount: 0,
    fundedReferralVolume: 0,
    referredCount: 0,
  });
  supabaseAdmin.getUserById.mockResolvedValue({ id: "user-1", referred_by: null });
  supabaseAdmin.getLargestTradeUsd.mockResolvedValue(0);
  supabaseAdmin.upsertRewardLedgerEntries.mockResolvedValue([]);
  supabaseAdmin.completeFillSync.mockResolvedValue(undefined);
});

describe("account fill sync", () => {
  it("grants XP for app-attributed fills and advances the cursor", async () => {
    const fetchFills = vi.fn(async () => [appFill(Date.parse(SEASON_START) + 5, 1)]);

    const result = await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    expect(result.errorCode).toBeNull();
    expect(result.fillsIngested).toBe(1);
    expect(supabaseAdmin.upsertRewardLedgerEntries).toHaveBeenCalledTimes(1);

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    // Two rows: the volume XP for the fill, and — the funding gate on
    // first_trade being gone — the quest grant the same fill completes.
    expect(entries).toHaveLength(2);
    expect(entries.find((e: { source: string }) => e.source === "volume_xp")).toMatchObject({
      idempotencyKey: "volume_xp:season-1:user-1:1:0xhash1:1",
      rewardKind: "xp",
      source: "volume_xp",
      status: "posted",
    });
    expect(entries.find((e: { source: string }) => e.source === "quest")).toMatchObject({
      idempotencyKey: "quest:season-1:user-1:first_trade:xp",
      rewardKind: "xp",
      status: "posted",
    });

    expect(supabaseAdmin.completeFillSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ checkpointId: "cp-1", cursorTime: new Date(NOW).toISOString() }),
    );
  });

  /**
   * The security property. Attribution used to test a client order ID prefix,
   * which is chosen by whoever places the order — so anyone could mint volume
   * XP by tagging orders routed through somebody else. A builder fee is
   * recorded by the exchange and cannot be set without actually paying one.
   */
  it("ignores a fill that spoofs the app cloid but paid no builder fee", async () => {
    const spoofed: RawFill = {
      builderFee: 0,
      cloid: "0x1a17deadbeefdeadbeef",
      hash: "0xspoof",
      oid: 77,
      px: 100_000,
      sz: 5,
      tid: 77,
      time: NOW - 100,
    };
    const fetchFills = vi.fn(async () => [spoofed]);

    await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    expect(entries.filter((e: { source: string }) => e.source === "volume_xp")).toEqual([]);
  });

  /**
   * The correctness half. Orders the app places without carrying the prefix
   * through — triggered take-profit and stop-loss among them — earned nothing.
   * On the first account checked, 99 of 108 fills had paid a builder fee and
   * only 24 carried the prefix.
   */
  it("grants XP for a fill that paid a builder fee without the app cloid", async () => {
    const untagged: RawFill = {
      builderFee: 0.02,
      cloid: null,
      hash: "0xtrigger",
      oid: 88,
      px: 200,
      sz: 1,
      tid: 88,
      time: NOW - 100,
    };
    const fetchFills = vi.fn(async () => [untagged]);

    await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    const volume = entries.filter((e: { source: string }) => e.source === "volume_xp");
    expect(volume).toHaveLength(1);
    expect((volume[0] as { metadata: { builderFeeUsd: number } }).metadata.builderFeeUsd).toBe(0.02);
  });

  it("ignores fills that paid no builder fee", async () => {
    const foreign: RawFill = { builderFee: 0, cloid: null, hash: "0xz", oid: 9, px: 500, sz: 2, tid: 9, time: NOW - 100 };
    const fetchFills = vi.fn(async () => [foreign]);

    const result = await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    expect(entries).toEqual([]);
    // The fill still counts as read: the window was covered either way, and the
    // cursor must advance past it or it will be re-fetched forever.
    expect(result.fillsIngested).toBe(1);
  });

  /**
   * The crash-before-commit case.
   *
   * The cursor advances only after the ledger write returns, so a failure
   * between them replays the window. That replay must not double-grant — which
   * it cannot, because the entries carry the same fill-keyed idempotency keys
   * and the ledger write ignores conflicts.
   */
  it("does not advance the cursor when the ledger write fails", async () => {
    supabaseAdmin.upsertRewardLedgerEntries.mockRejectedValue(new Error("db down"));
    const fetchFills = vi.fn(async () => [appFill(Date.parse(SEASON_START) + 5, 1)]);

    const result = await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    expect(result.errorCode).toBe("LEDGER_WRITE_FAILED");
    expect(supabaseAdmin.completeFillSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ cursorTime: expect.anything() }),
    );
  });

  it("replays a window to identical idempotency keys", async () => {
    const fills = [appFill(Date.parse(SEASON_START) + 5, 1), appFill(Date.parse(SEASON_START) + 6, 2)];
    const fetchFills = vi.fn(async () => fills);

    await syncAccountFills(config(), claim(), { fetchFills, now: () => NOW, isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START });
    const first = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]![1].map(
      (e: { idempotencyKey: string }) => e.idempotencyKey,
    );

    supabaseAdmin.upsertRewardLedgerEntries.mockClear();
    await syncAccountFills(config(), claim(), { fetchFills, now: () => NOW, isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START });
    const second = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]![1].map(
      (e: { idempotencyKey: string }) => e.idempotencyKey,
    );

    expect(second).toEqual(first);
  });

  /**
   * An exchange outage is one account's problem, recorded against that
   * account's checkpoint. Nothing is written and the cursor stands.
   */
  it("records an exchange failure without writing or advancing", async () => {
    const fetchFills = vi.fn(async () => {
      throw new Error("hyperliquid 503 upstream detail that must not be stored");
    });

    const result = await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    expect(result.errorCode).toBe("EXCHANGE_UNAVAILABLE");
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();

    const [, completion] = supabaseAdmin.completeFillSync.mock.calls[0]!;
    expect(completion.cursorTime).toBeUndefined();
    // A machine-readable class only — never the upstream body.
    expect(JSON.stringify(completion)).not.toContain("503");
    expect(JSON.stringify(completion)).not.toContain("hyperliquid");
  });

  it("never reads a window that extends past now", async () => {
    const windows: FillWindow[] = [];
    const fetchFills = vi.fn(async (_wallet: string, window: FillWindow) => {
      windows.push(window);
      return [];
    });

    await syncAccountFills(config(), claim(), {
      fetchFills: (wallet, window) => fetchFills(wallet, window),
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    // A window into the future would advance the cursor over fills that have
    // not happened yet, and those fills would then never be read.
    for (const window of windows) {
      expect(window.endMs).toBeLessThanOrEqual(NOW);
    }
  });

  it("does nothing when the cursor is already at now", async () => {
    const fetchFills = vi.fn(async () => []);

    const result = await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(NOW + 10_000).toISOString() }),
      { fetchFills, now: () => NOW, isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START },
    );

    expect(fetchFills).not.toHaveBeenCalled();
    expect(result.errorCode).toBeNull();
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
  });

  /**
   * Past the exchange's history ceiling a full reconstruction stops being
   * provable, even though everything ingested is correct. Reconciliation has to
   * be able to see that.
   */
  it("flags retention risk once the history ceiling is in reach", async () => {
    const fetchFills = vi.fn(async () => [appFill(Date.parse(SEASON_START) + 5, 1)]);

    const result = await syncAccountFills(config(), claim({ fillsIngested: 9_999 }), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    expect(result.retentionRisk).toBe(true);
    expect(supabaseAdmin.completeFillSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ retentionRisk: true }),
    );
  });

  it("propagates retention risk from an unresolvable window", async () => {
    // More fills than a page can hold, all in one millisecond.
    const dense = Array.from({ length: FILL_PAGE_LIMIT + 50 }, (_, i) =>
      appFill(Date.parse(SEASON_START) + 1, i + 1),
    );
    const fetchFills = vi.fn(async (_wallet: string, window: FillWindow) =>
      dense.filter((f) => f.time >= window.startMs && f.time <= window.endMs).slice(0, FILL_PAGE_LIMIT),
    );

    const result = await syncAccountFills(config(), claim(), {
      fetchFills: (wallet, window) => fetchFills(wallet, window),
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    expect(result.retentionRisk).toBe(true);
  });

  /**
   * Referral XP no longer comes from here at all.
   *
   * The old grant key was quest:{season}:{referrer}:referral_funded_friend:xp —
   * one row per referrer per season — so a referrer who brought ten funded
   * friends was paid for one. The milestone ladder keys on the referee and runs
   * once per worker pass; this path must not also pay, or both would.
   */
  it("writes no referral XP, leaving that to the milestone ladder", async () => {
    supabaseAdmin.getUserById.mockResolvedValue({ id: "user-1", referred_by: "referrer-1" });
    supabaseAdmin.getQualifyingDeposits.mockResolvedValue([
      { amountUsd: 100, occurredAt: SEASON_START },
    ]);
    const fetchFills = vi.fn(async () => []);

    await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      isCurrentSeason: true, seasonEndsAt: SEASON_END, seasonStartsAt: SEASON_START,
    });

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    const sources = entries.map((e: { source: string }) => e.source);

    expect(sources).not.toContain("referral_bonus");
    expect(sources).not.toContain("referral");
    // Nothing is granted to anybody other than the account being synced.
    expect(entries.every((e: { userId: string }) => e.userId === "user-1")).toBe(true);
  });
});

/**
 * The season-rollover double grant.
 *
 * Checkpoints are keyed (user, season, wallet), and nothing retired one when
 * its season ended. The window was clamped only to `now`, so on 2026-09-01
 * every August checkpoint kept reading [cursor, now] into September beside the
 * September checkpoint for the same wallet. The grant key embeds the season,
 * so the two never collided and each fill was granted once under each. These
 * pin the bound that stops it, independently of migration 030's claim filter.
 */
describe("season boundary", () => {
  const AUG_END_MS = Date.parse(SEASON_END);
  // Three weeks into September, where production stood when this was found.
  const LATE_SEPTEMBER = Date.parse("2026-09-22T00:00:00.000Z");

  /** Models the exchange: only fills inside the requested window come back. */
  function exchangeWith(fills: RawFill[]) {
    return vi.fn(async (_wallet: string, window: FillWindow) =>
      fills.filter((fill) => fill.time >= window.startMs && fill.time <= window.endMs),
    );
  }

  it("stops a closed season's checkpoint at that season's last millisecond", async () => {
    const lastMinuteOfAugust = appFill(AUG_END_MS - 60_000, 1);
    const firstInstantOfSeptember = appFill(AUG_END_MS, 2);
    const midSeptember = appFill(Date.parse("2026-09-05T12:00:00.000Z"), 3);
    const fetchFills = exchangeWith([lastMinuteOfAugust, firstInstantOfSeptember, midSeptember]);

    const result = await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(AUG_END_MS - 10 * 60_000).toISOString() }),
      {
        fetchFills,
        isCurrentSeason: false,
        now: () => LATE_SEPTEMBER,
        seasonEndsAt: SEASON_END,
        seasonStartsAt: "2026-09-01T00:00:00.000Z",
      },
    );

    expect(result.errorCode).toBeNull();
    // Inclusive windows against a half-open season: the last instant read is
    // one millisecond before ends_at, never ends_at itself.
    for (const [, window] of fetchFills.mock.calls) {
      expect(window.endMs).toBeLessThanOrEqual(AUG_END_MS - 1);
    }

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    const volumeKeys = entries
      .filter((entry: { source: string }) => entry.source === "volume_xp")
      .map((entry: { metadata: { fillKey: string } }) => entry.metadata.fillKey);
    // Only August's own fill. The instant-of-rollover fill and mid-September
    // are the current season's, and granting them here is the defect.
    expect(volumeKeys).toHaveLength(1);
    expect(volumeKeys[0]).toContain("0xhash1");
  });

  /**
   * A window that reaches the season's end marks the season done by writing
   * ends_at exactly — the value migration 030's claim reads as complete
   * (`cursor_time < ends_at`). Writing ends_at - 1 instead would leave the
   * checkpoint re-offered forever on a zero-width window.
   */
  it("retires the checkpoint by writing the season boundary as its cursor", async () => {
    await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(AUG_END_MS - 10 * 60_000).toISOString() }),
      {
        fetchFills: exchangeWith([]),
        isCurrentSeason: false,
        now: () => LATE_SEPTEMBER,
        seasonEndsAt: SEASON_END,
        seasonStartsAt: "2026-09-01T00:00:00.000Z",
      },
    );

    expect(supabaseAdmin.completeFillSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursorTime: SEASON_END }),
    );
  });

  /**
   * Where every August checkpoint stood by the time this was fixed: cursor
   * three weeks past its season's end. Even offered by a claim RPC that
   * predates migration 030, it must read and grant nothing.
   */
  it("grants nothing for a checkpoint already past its season", async () => {
    const fetchFills = exchangeWith([appFill(LATE_SEPTEMBER - 1000, 9)]);

    const result = await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(LATE_SEPTEMBER - 60_000).toISOString() }),
      {
        fetchFills,
        isCurrentSeason: false,
        now: () => LATE_SEPTEMBER,
        seasonEndsAt: SEASON_END,
        seasonStartsAt: "2026-09-01T00:00:00.000Z",
      },
    );

    expect(result.errorCode).toBeNull();
    expect(fetchFills).not.toHaveBeenCalled();
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
  });

  /**
   * Quests read the present — the deposit read starts at the *current*
   * season's start and channel membership has no date — which is how an old
   * claim paid first_deposit and first_trade under August for September's
   * activity. A closed season's tail grants its volume and nothing else.
   */
  it("grants no quests while finishing a closed season", async () => {
    // A fill that, in a current-season claim, completes first_trade.
    const fetchFills = exchangeWith([appFill(AUG_END_MS - 60_000, 1)]);
    supabaseAdmin.getQualifyingDeposits.mockResolvedValue([
      { amountUsd: 500, id: "dep-sept", occurredAt: "2026-09-02T00:00:00.000Z" },
    ]);

    await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(AUG_END_MS - 10 * 60_000).toISOString() }),
      {
        fetchFills,
        isCurrentSeason: false,
        now: () => LATE_SEPTEMBER,
        seasonEndsAt: SEASON_END,
        seasonStartsAt: "2026-09-01T00:00:00.000Z",
      },
    );

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    expect(entries.some((entry: { source: string }) => entry.source === "quest")).toBe(false);
    // Not merely filtered out: the present-tense reads are never made.
    expect(supabaseAdmin.getQualifyingDeposits).not.toHaveBeenCalled();
  });

  /**
   * NaN does not bound anything. Math.min returns it, the early return does
   * not fire, and the exchange would be asked for [cursor, now] -- the exact
   * unbounded read the season bound exists to remove.
   */
  it("fails closed on a season end that does not parse", async () => {
    const fetchFills = exchangeWith([appFill(LATE_SEPTEMBER - 1000, 9)]);

    const result = await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(AUG_END_MS - 10 * 60_000).toISOString() }),
      {
        fetchFills,
        isCurrentSeason: false,
        now: () => LATE_SEPTEMBER,
        seasonEndsAt: "not-a-date",
        seasonStartsAt: "2026-09-01T00:00:00.000Z",
      },
    );

    expect(result.errorCode).toBe("SEASON_BOUNDS_INVALID");
    expect(fetchFills).not.toHaveBeenCalled();
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
    expect(supabaseAdmin.completeFillSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "SEASON_BOUNDS_INVALID" }),
    );
  });

  /**
   * The invariant migration 030's repair depends on: no quest is ever written
   * after its season has ended. isCurrentSeason is computed once, at the start
   * of a run, so a run that straddles midnight would otherwise still evaluate
   * quests for a claim whose season has just closed -- and the repair, which
   * reads "written after its season ended" as "pre-fix", would then hold a
   * legitimate grant on a later re-run.
   */
  it("writes no quest for a claim whose season ended during the run", async () => {
    const fetchFills = exchangeWith([appFill(AUG_END_MS - 60_000, 1)]);

    await syncAccountFills(
      config(),
      claim({ cursorTime: new Date(AUG_END_MS - 10 * 60_000).toISOString() }),
      {
        fetchFills,
        // The run began in August, so the worker still calls it current...
        isCurrentSeason: true,
        // ...but this claim is processed thirty seconds after midnight.
        now: () => AUG_END_MS + 30_000,
        seasonEndsAt: SEASON_END,
        seasonStartsAt: SEASON_START,
      },
    );

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    expect(entries.some((entry: { source: string }) => entry.source === "quest")).toBe(false);
    // The volume the window read is still granted -- only quests are withheld.
    expect(entries.some((entry: { source: string }) => entry.source === "volume_xp")).toBe(true);
  });

  it("leaves a live season's cursor at now, not at the season's end", async () => {
    await syncAccountFills(config(), claim(), {
      fetchFills: exchangeWith([]),
      isCurrentSeason: true,
      now: () => NOW,
      seasonEndsAt: SEASON_END,
      seasonStartsAt: SEASON_START,
    });

    expect(supabaseAdmin.completeFillSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursorTime: new Date(NOW).toISOString() }),
    );
  });
});
