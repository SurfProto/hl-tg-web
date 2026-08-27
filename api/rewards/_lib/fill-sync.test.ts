import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILL_PAGE_LIMIT, type FillWindow, type RawFill } from "./fill-windows";

const supabaseAdmin = vi.hoisted(() => ({
  completeFillSync: vi.fn(),
  getFundedReferralStats: vi.fn(),
  getSuccessfulOnrampDeposits: vi.fn(),
  getUserById: vi.fn(),
  upsertRewardLedgerEntries: vi.fn(),
}));

vi.mock("./supabase-admin", () => supabaseAdmin);

import { syncAccountFills } from "./fill-sync";

const SEASON_START = "2026-08-01T00:00:00.000Z";

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
  supabaseAdmin.getSuccessfulOnrampDeposits.mockResolvedValue([]);
  supabaseAdmin.getFundedReferralStats.mockResolvedValue({
    fundedReferralCount: 0,
    fundedReferralVolume: 0,
    referredCount: 0,
  });
  supabaseAdmin.getUserById.mockResolvedValue({ id: "user-1", referred_by: null });
  supabaseAdmin.upsertRewardLedgerEntries.mockResolvedValue([]);
  supabaseAdmin.completeFillSync.mockResolvedValue(undefined);
});

describe("account fill sync", () => {
  it("grants XP for app-attributed fills and advances the cursor", async () => {
    const fetchFills = vi.fn(async () => [appFill(Date.parse(SEASON_START) + 5, 1)]);

    const result = await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      seasonStartsAt: SEASON_START,
    });

    expect(result.errorCode).toBeNull();
    expect(result.fillsIngested).toBe(1);
    expect(supabaseAdmin.upsertRewardLedgerEntries).toHaveBeenCalledTimes(1);

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      idempotencyKey: "volume_xp:season-1:user-1:1:0xhash1:1",
      rewardKind: "xp",
      source: "volume_xp",
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
      seasonStartsAt: SEASON_START,
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
      seasonStartsAt: SEASON_START,
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
      seasonStartsAt: SEASON_START,
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
      seasonStartsAt: SEASON_START,
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

    await syncAccountFills(config(), claim(), { fetchFills, now: () => NOW, seasonStartsAt: SEASON_START });
    const first = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]![1].map(
      (e: { idempotencyKey: string }) => e.idempotencyKey,
    );

    supabaseAdmin.upsertRewardLedgerEntries.mockClear();
    await syncAccountFills(config(), claim(), { fetchFills, now: () => NOW, seasonStartsAt: SEASON_START });
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
      seasonStartsAt: SEASON_START,
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
      seasonStartsAt: SEASON_START,
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
      { fetchFills, now: () => NOW, seasonStartsAt: SEASON_START },
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
      seasonStartsAt: SEASON_START,
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
      seasonStartsAt: SEASON_START,
    });

    expect(result.retentionRisk).toBe(true);
  });

  it("writes the referred user's bonus and the referrer's quest together", async () => {
    supabaseAdmin.getUserById.mockResolvedValue({ id: "user-1", referred_by: "referrer-1" });
    supabaseAdmin.getSuccessfulOnrampDeposits.mockResolvedValue([
      { amountUsd: 100, occurredAt: SEASON_START },
    ]);
    const fetchFills = vi.fn(async () => []);

    await syncAccountFills(config(), claim(), {
      fetchFills,
      now: () => NOW,
      seasonStartsAt: SEASON_START,
    });

    const [, entries] = supabaseAdmin.upsertRewardLedgerEntries.mock.calls[0]!;
    const sources = entries.map((e: { source: string; userId: string }) => `${e.source}:${e.userId}`);

    expect(sources).toContain("referral_bonus:user-1");
    expect(sources).toContain("quest:referrer-1");
    expect(entries.every((e: { rewardKind: string }) => e.rewardKind === "xp")).toBe(true);
  });
});
