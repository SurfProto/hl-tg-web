import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  buildHeaders: vi.fn((_config: unknown, extra?: Record<string, string>) => ({ ...extra })),
  supabaseRequest: vi.fn(),
}));

vi.mock("../../_lib/supabase", () => supabase);

import {
  getExistingVolumeXpFillKeys,
  getSeasonXpTotals,
  upsertRewardLedgerEntries,
} from "./supabase-admin";

const config = { supabaseUrl: "https://example.supabase.co" } as never;

const SEASON = "season-1";
const USER = "user-1";

/** The real shape: Hyperliquid fill keys are `tid:hash:oid`, so they contain colons. */
const FILL_KEY = "98765:0xabc123def456:42";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reward ledger writes are append-only", () => {
  /**
   * `resolution=merge-duplicates` made every insert a blind UPDATE of any row
   * sharing an idempotency key. A sync running over a cash entry that had
   * already been paid rewrote it back to the values being inserted — status
   * 'pending', posted_at null — and offered it for payment all over again.
   */
  it("asks PostgREST to ignore conflicts rather than merge them", async () => {
    supabase.supabaseRequest.mockResolvedValue([]);

    await upsertRewardLedgerEntries(config, [
      {
        amount: 500,
        asset: null,
        description: "Quest XP",
        idempotencyKey: `quest:${SEASON}:${USER}:first_deposit:xp`,
        metadata: null,
        postedAt: new Date().toISOString(),
        questId: "first_deposit",
        rewardKind: "xp",
        seasonId: SEASON,
        source: "quest",
        status: "posted",
        userId: USER,
        weekStart: null,
      },
    ]);

    const prefer = supabase.buildHeaders.mock.calls.at(-1)?.[1]?.Prefer ?? "";
    expect(prefer).toContain("resolution=ignore-duplicates");
    expect(prefer).not.toContain("merge-duplicates");
  });

  it("writes nothing at all for an empty batch", async () => {
    await expect(upsertRewardLedgerEntries(config, [])).resolves.toEqual([]);
    expect(supabase.supabaseRequest).not.toHaveBeenCalled();
  });
});

describe("volume XP fill keys round-trip in full", () => {
  /**
   * The idempotency key is `volume_xp:season:user:tid:hash:oid`. Splitting on
   * ":" and taking the last segment returned the order id alone — a value that
   * matches no fill key the grant builder compares against, so the "already
   * granted" set suppressed nothing and every sync re-derived grants across the
   * user's entire history. Only the unique index stopped that duplicating XP.
   */
  it("recovers the whole key from the idempotency key, colons included", async () => {
    supabase.supabaseRequest.mockResolvedValue([
      { idempotency_key: `volume_xp:${SEASON}:${USER}:${FILL_KEY}`, metadata: null },
    ]);

    const keys = await getExistingVolumeXpFillKeys(config, USER, SEASON);

    expect(keys.has(FILL_KEY)).toBe(true);
    expect(keys.has("42")).toBe(false);
  });

  it("prefers the key recorded in metadata", async () => {
    supabase.supabaseRequest.mockResolvedValue([
      {
        idempotency_key: `volume_xp:${SEASON}:${USER}:stale-legacy-key`,
        metadata: { fillKey: FILL_KEY, volumeUsd: 120.5 },
      },
    ]);

    const keys = await getExistingVolumeXpFillKeys(config, USER, SEASON);

    expect([...keys]).toEqual([FILL_KEY]);
  });

  // A key written under a different season or user does not carry this
  // request's prefix. Returning it whole is wrong-but-harmless; slicing a
  // prefix that is not there would corrupt it.
  it("leaves a key without the expected prefix intact", async () => {
    supabase.supabaseRequest.mockResolvedValue([
      { idempotency_key: "volume_xp:other-season:other-user:1:2:3", metadata: null },
    ]);

    const keys = await getExistingVolumeXpFillKeys(config, USER, SEASON);

    expect([...keys]).toEqual(["volume_xp:other-season:other-user:1:2:3"]);
  });

  it("asks for metadata alongside the idempotency key", async () => {
    supabase.supabaseRequest.mockResolvedValue([]);

    await getExistingVolumeXpFillKeys(config, USER, SEASON);

    expect(supabase.supabaseRequest.mock.calls[0]![1]).toContain("select=idempotency_key,metadata");
  });
});

describe("season XP totals come from the database", () => {
  it("maps per-source rows and totals every source", async () => {
    supabase.supabaseRequest.mockResolvedValue([
      { source: "quest", xp: "800" },
      { source: "volume_xp", xp: "8000" },
      { source: "referral_bonus", xp: "500" },
    ]);

    await expect(getSeasonXpTotals(config, USER, SEASON)).resolves.toEqual({
      questXp: 800,
      referralBonusXp: 500,
      totalXp: 9300,
      volumeXp: 8000,
    });
  });

  // The breakdown fields name three known sources; the total must not quietly
  // drop XP granted under a source added later.
  it("counts an unknown source in the total", async () => {
    supabase.supabaseRequest.mockResolvedValue([
      { source: "quest", xp: 100 },
      { source: "some_future_source", xp: 250 },
    ]);

    const totals = await getSeasonXpTotals(config, USER, SEASON);

    expect(totals.totalXp).toBe(350);
    expect(totals.questXp).toBe(100);
  });

  it("reports zero for a user with no ledger rows", async () => {
    supabase.supabaseRequest.mockResolvedValue([]);

    await expect(getSeasonXpTotals(config, USER, SEASON)).resolves.toEqual({
      questXp: 0,
      referralBonusXp: 0,
      totalXp: 0,
      volumeXp: 0,
    });
  });

  it("calls the aggregate RPC rather than reading rows", async () => {
    supabase.supabaseRequest.mockResolvedValue([]);

    await getSeasonXpTotals(config, USER, SEASON);

    expect(supabase.supabaseRequest.mock.calls[0]![1]).toBe("rpc/rewards_season_xp_totals");
    expect(JSON.parse(supabase.supabaseRequest.mock.calls[0]![2].body)).toEqual({
      p_season_id: SEASON,
      p_user_id: USER,
    });
  });
});
