import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RewardsConfig } from "./config";

const supabaseAdmin = vi.hoisted(() => ({
  applyReferralCodeIfEligible: vi.fn(),
  ensureReferralCode: vi.fn(),
  getExistingVolumeXpFillKeys: vi.fn(),
  getFundedReferralStats: vi.fn(),
  getOrCreateActiveSeason: vi.fn(),
  getOrCreateRewardsUser: vi.fn(),
  getRewardLedgerEntries: vi.fn(),
  getRewardLedgerEntriesBySource: vi.fn(),
  getSeasonLeaderboard: vi.fn(),
  getSeasonUserRank: vi.fn(),
  getSeasonXpTotals: vi.fn(),
  getActiveSeason: vi.fn(),
  getGrantedQuestIds: vi.fn(),
  getFillCheckpointStatus: vi.fn(),
  claimReferrer: vi.fn(),
  getSuccessfulOnrampDeposits: vi.fn(),
  getUserById: vi.fn(),
  getUserByReferralCode: vi.fn(),
  getUserPointsForSeason: vi.fn(),
  getUsersByIds: vi.fn(),
  getWeeklyVolumeRows: vi.fn(),
  patchWeeklyReward: vi.fn(),
  upsertRewardLedgerEntries: vi.fn(),
  upsertUserPoints: vi.fn(),
  upsertWeeklyReward: vi.fn(),
  updateRewardLedgerStatus: vi.fn(),
}));

const payout = vi.hoisted(() => ({
  hasRewardsTreasury: vi.fn(),
  sendRewardUsdc: vi.fn(),
}));

vi.mock("./supabase-admin", () => supabaseAdmin);
vi.mock("./payout", () => payout);
vi.mock("@repo/hyperliquid-sdk", () => ({ HyperliquidClient: vi.fn() }));

function config(): RewardsConfig {
  return {
    firstTradeThresholdUsd: 50,
    fundedDepositThresholdUsd: 50,
    hyperliquidTestnet: false,
    privyAppId: null,
    rafflePrizeAmounts: [100],
    rewardsAdminKey: "admin-secret",
    supabaseServiceRoleKey: "service-role",
    supabaseUrl: "https://example.supabase.co",
    weeklyRewardPoolUsd: 100,
    weeklyTopTraderCohortSize: 10,
    weeklyWinnerCount: 1,
    xpPerUsd: 1,
  };
}

/** The ledger rows a single sync tried to write. */
function writtenEntries() {
  return supabaseAdmin.upsertRewardLedgerEntries.mock.calls.flatMap(
    (call) => call[1] as Array<Record<string, unknown>>,
  );
}

describe("applyReferralCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseAdmin.getOrCreateRewardsUser.mockResolvedValue({
      id: "user-1",
      referral_code: "MINE1234",
      referred_by: null,
      username: "user",
      wallet_address: null,
    });
    supabaseAdmin.ensureReferralCode.mockImplementation(async (_c, user) => user);
    supabaseAdmin.getUserByReferralCode.mockResolvedValue({ id: "referrer-1" });
    supabaseAdmin.getOrCreateActiveSeason.mockResolvedValue({
      id: "season-1",
      name: "Season 1",
      starts_at: "2026-08-01T00:00:00.000Z",
      ends_at: "2026-09-01T00:00:00.000Z",
    });
    supabaseAdmin.getFundedReferralStats.mockResolvedValue({
      fundedReferralCount: 0,
      fundedReferralVolume: 0,
      referredCount: 0,
    });
    supabaseAdmin.claimReferrer.mockResolvedValue("ok");
  });

  /**
   * The link used to be a read of `referred_by`, a decision, and then a patch.
   * Two codes applied at once could both see null and the second would
   * overwrite the first. The conditions now live in the UPDATE.
   */
  it("links the referrer through the atomic claim", async () => {
    const { applyReferralCode } = await import("./program");

    const summary = await applyReferralCode("privy-1", "FRIEND12", config());

    expect(supabaseAdmin.claimReferrer).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "referrer-1",
    );
    expect(summary.hasReferrer).toBe(true);
  });

  it("reports a lost race as already linked rather than overwriting", async () => {
    supabaseAdmin.claimReferrer.mockResolvedValue("already_set");
    const { applyReferralCode } = await import("./program");

    await expect(applyReferralCode("privy-1", "FRIEND12", config())).rejects.toMatchObject({
      code: "REFERRAL_ALREADY_SET",
      statusCode: 409,
    });
  });

  // The database rejects self-referral too, not just the pre-check on the code.
  it("refuses a self-referral the database catches", async () => {
    supabaseAdmin.claimReferrer.mockResolvedValue("self_referral");
    const { applyReferralCode } = await import("./program");

    await expect(applyReferralCode("privy-1", "FRIEND12", config())).rejects.toMatchObject({
      code: "SELF_REFERRAL_NOT_ALLOWED",
      statusCode: 409,
    });
  });

  it("rejects an unknown code before attempting a claim", async () => {
    supabaseAdmin.getUserByReferralCode.mockResolvedValue(null);
    const { applyReferralCode } = await import("./program");

    await expect(applyReferralCode("privy-1", "NOPE1234", config())).rejects.toMatchObject({
      code: "REFERRAL_CODE_NOT_FOUND",
    });
    expect(supabaseAdmin.claimReferrer).not.toHaveBeenCalled();
  });
});

describe("getRewardsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseAdmin.getOrCreateRewardsUser.mockResolvedValue({
      id: "user-1",
      username: "user",
      wallet_address: null,
      referral_code: "CODE123",
      referred_by: null,
    });
    supabaseAdmin.ensureReferralCode.mockImplementation(async (_config, user) => user);
    supabaseAdmin.applyReferralCodeIfEligible.mockImplementation(async (_config, args) => args.user);
    supabaseAdmin.getGrantedQuestIds.mockResolvedValue([]);
    supabaseAdmin.getFillCheckpointStatus.mockResolvedValue({
      consecutiveFailures: 0,
      cursorTime: "2026-04-01T00:00:00.000Z",
      lastSuccessAt: new Date().toISOString(),
      retentionRisk: false,
    });
    supabaseAdmin.getActiveSeason.mockResolvedValue({
      id: "season-1",
      name: "Season 1",
      starts_at: "2026-04-01T00:00:00.000Z",
      ends_at: "2026-05-01T00:00:00.000Z",
    });
    supabaseAdmin.getOrCreateActiveSeason.mockResolvedValue({
      id: "season-1",
      name: "Season 1",
      starts_at: "2026-04-01T00:00:00.000Z",
      ends_at: "2026-05-01T00:00:00.000Z",
    });
    supabaseAdmin.getSuccessfulOnrampDeposits.mockResolvedValue([]);
    supabaseAdmin.getFundedReferralStats.mockResolvedValue({
      fundedReferralCount: 0,
      fundedReferralVolume: 0,
      referredCount: 0,
    });
    supabaseAdmin.getExistingVolumeXpFillKeys.mockResolvedValue(new Set());
    supabaseAdmin.upsertRewardLedgerEntries.mockResolvedValue([]);
    supabaseAdmin.getRewardLedgerEntries.mockResolvedValue([]);
    supabaseAdmin.getSeasonXpTotals.mockResolvedValue({
      questXp: 0,
      referralBonusXp: 0,
      totalXp: 0,
      volumeXp: 0,
    });
    supabaseAdmin.upsertUserPoints.mockResolvedValue(undefined);
    supabaseAdmin.upsertWeeklyReward.mockResolvedValue(undefined);
    supabaseAdmin.getSeasonLeaderboard.mockResolvedValue([]);
    supabaseAdmin.getSeasonUserRank.mockResolvedValue(null);
    supabaseAdmin.getUserPointsForSeason.mockResolvedValue({ xp: 0 });
  });

  it("advertises XP-only capabilities to the client", async () => {
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.programStatus).toEqual({
      mode: "xp_only",
      usdcPayoutsEnabled: false,
      weeklyRaffleEnabled: false,
    });
    expect(dashboard.weeklyRaffle).toEqual({ state: "paused" });
  });

  /**
   * The negative payout test the safety release exists for.
   *
   * A configured treasury key must be inert: `RewardsConfig` no longer carries
   * one and `program.ts` no longer has a path to `payout.ts`, so the money is
   * unreachable rather than merely un-sent. `server-imports.test.ts` asserts
   * the structural half; this asserts nothing calls it at runtime either.
   */
  it("sends no USDC even when a treasury key is configured", async () => {
    const previous = process.env.REWARDS_TREASURY_PRIVATE_KEY;
    process.env.REWARDS_TREASURY_PRIVATE_KEY = `0x${"1".repeat(64)}`;

    try {
      supabaseAdmin.getOrCreateRewardsUser.mockResolvedValue({
        id: "user-1",
        username: "user",
        wallet_address: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
        referral_code: "CODE123",
        referred_by: null,
      });
      supabaseAdmin.getRewardLedgerEntries.mockResolvedValue([
        {
          id: "ledger-1",
          amount: 25,
          asset: "USDC",
          createdAt: "2026-04-14T00:00:00.000Z",
          description: "Held payout",
          metadata: null,
          postedAt: null,
          questId: null,
          rewardKind: "usdc",
          seasonId: "season-1",
          source: "quest",
          status: "held",
          userId: "user-1",
          weekStart: "2026-04-14T00:00:00.000Z",
        },
      ]);
      const { getRewardsDashboard } = await import("./program");

      await getRewardsDashboard({ privyUserId: "privy-1" }, config());

      expect(payout.sendRewardUsdc).not.toHaveBeenCalled();
      expect(payout.hasRewardsTreasury).not.toHaveBeenCalled();
      // A held row is terminal. Nothing may promote it back towards payment.
      expect(supabaseAdmin.updateRewardLedgerStatus).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.REWARDS_TREASURY_PRIVATE_KEY;
      } else {
        process.env.REWARDS_TREASURY_PRIVATE_KEY = previous;
      }
    }
  });

  it("keeps cash history out of the user-facing response", async () => {
    supabaseAdmin.getRewardLedgerEntries.mockResolvedValue([
      { id: "xp-1", rewardKind: "xp", amount: 500, source: "quest", status: "posted" },
      { id: "cash-1", rewardKind: "usdc", amount: 5, source: "quest", status: "held" },
      { id: "cash-2", rewardKind: "usdc", amount: 3, source: "quest", status: "posted" },
      { id: "raffle-1", rewardKind: "raffle", amount: 50, source: "weekly_raffle", status: "held" },
    ]);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.rewardHistory.map((entry) => entry.id)).toEqual(["xp-1"]);
  });

  /**
   * The 150-row accounting horizon.
   *
   * Totals were summed from the reward history the dashboard had already
   * fetched for display, which is capped at 150 rows ordered newest-first. Past
   * that cap a user's XP was recomputed from a recent window and written back
   * over the projection, so it fell as they earned more. The database now
   * answers the question, and the history page is display-only.
   */
  it("totals XP from the database aggregate, not the history page", async () => {
    supabaseAdmin.getSeasonXpTotals.mockResolvedValue({
      questXp: 800,
      referralBonusXp: 500,
      totalXp: 9300,
      volumeXp: 8000,
    });
    // A history page that is both truncated and unrepresentative: summing it
    // would give 25, which is what the old implementation would have stored.
    supabaseAdmin.getRewardLedgerEntries.mockResolvedValue([
      { id: "recent", rewardKind: "xp", amount: 25, source: "volume_xp", status: "posted" },
    ]);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.season.xpTotal).toBe(9300);
    expect(dashboard.season.questXpTotal).toBe(800);
    expect(dashboard.season.volumeXpTotal).toBe(8000);
    expect(supabaseAdmin.getSeasonXpTotals).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "season-1",
    );
  });

  // user_points is a cache of an answer the ledger owns, so the dashboard
  // reports the aggregate rather than reading back a row it wrote.
  it("reports the ledger aggregate without touching the projection", async () => {
    supabaseAdmin.getSeasonXpTotals.mockResolvedValue({
      questXp: 500,
      referralBonusXp: 0,
      totalXp: 1400,
      volumeXp: 900,
    });
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.season.xpTotal).toBe(1400);
    expect(supabaseAdmin.getUserPointsForSeason).not.toHaveBeenCalled();
  });

  /**
   * The point of the ingestion release.
   *
   * Opening this screen used to be able to create a season, apply a referral,
   * call Hyperliquid, insert ledger rows, rewrite two projections and attempt a
   * USDC transfer. Whether a user could see their points was coupled to whether
   * the exchange was reachable, and accounting completeness depended on who
   * happened to visit.
   */
  it("writes no reward state and performs no exchange I/O", async () => {
    const { getRewardsDashboard } = await import("./program");

    await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
    expect(supabaseAdmin.upsertUserPoints).not.toHaveBeenCalled();
    expect(supabaseAdmin.upsertWeeklyReward).not.toHaveBeenCalled();
    expect(supabaseAdmin.updateRewardLedgerStatus).not.toHaveBeenCalled();
    // Creating a season because somebody opened a page is the race this removes.
    expect(supabaseAdmin.getOrCreateActiveSeason).not.toHaveBeenCalled();
    expect(supabaseAdmin.getActiveSeason).toHaveBeenCalled();
  });

  // A referral is applied by the explicit mutation, before this is read.
  it("does not assign a referral", async () => {
    const { getRewardsDashboard } = await import("./program");

    await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(supabaseAdmin.applyReferralCodeIfEligible).not.toHaveBeenCalled();
    expect(supabaseAdmin.claimReferrer).not.toHaveBeenCalled();
  });

  /**
   * The read path has no fills, so a quest the ledger already paid must still
   * show as completed — otherwise a user who earned "first trade" would watch
   * it revert the moment ingestion moved off the page.
   */
  it("takes trade-derived quest completion from the ledger", async () => {
    supabaseAdmin.getGrantedQuestIds.mockResolvedValue(["first_trade"]);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    const firstTrade = dashboard.quests.find((quest) => quest.id === "first_trade");
    expect(firstTrade?.status).toBe("completed");
  });

  it("reports syncing before ingestion has ever succeeded", async () => {
    supabaseAdmin.getFillCheckpointStatus.mockResolvedValue(null);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.sync).toEqual({
      lastSyncedAt: null,
      retentionRisk: false,
      state: "syncing",
    });
  });

  it("reports stale when the last success is old", async () => {
    supabaseAdmin.getFillCheckpointStatus.mockResolvedValue({
      consecutiveFailures: 0,
      cursorTime: "2026-04-01T00:00:00.000Z",
      lastSuccessAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      retentionRisk: false,
    });
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.sync.state).toBe("stale");
  });

  it("reports error after repeated failures, without leaking a reason", async () => {
    supabaseAdmin.getFillCheckpointStatus.mockResolvedValue({
      consecutiveFailures: 5,
      cursorTime: "2026-04-01T00:00:00.000Z",
      lastSuccessAt: new Date().toISOString(),
      retentionRisk: true,
    });
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.sync.state).toBe("error");
    expect(dashboard.sync.retentionRisk).toBe(true);
    expect(Object.keys(dashboard.sync).sort()).toEqual([
      "lastSyncedAt",
      "retentionRisk",
      "state",
    ]);
  });

  // Before any season exists there is nothing earned and nothing to invent.
  it("returns an empty dashboard rather than creating a season", async () => {
    supabaseAdmin.getActiveSeason.mockResolvedValue(null);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.season.seasonId).toBeNull();
    expect(dashboard.quests).toEqual([]);
    expect(dashboard.sync.state).toBe("syncing");
    expect(supabaseAdmin.getOrCreateActiveSeason).not.toHaveBeenCalled();
  });

  /**
   * The leaderboard used to send every viewer the other traders' Telegram
   * usernames, falling back to a six-character wallet prefix. Neither is
   * something a trader published by placing a trade.
   */
  it("identifies other traders only by an opaque alias", async () => {
    supabaseAdmin.getSeasonLeaderboard.mockResolvedValue([
      { alias: "Trader-1C27BA90", eligibleVolume: 5000, isCurrentUser: false, rank: 1, xp: 900 },
      { alias: "Trader-38C6CBD2", eligibleVolume: 1000, isCurrentUser: true, rank: 2, xp: 500 },
    ]);
    supabaseAdmin.getSeasonUserRank.mockResolvedValue(2);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    const serialized = JSON.stringify(dashboard.leaderboard);
    expect(serialized).not.toContain("username");
    expect(serialized).not.toContain("0x");
    expect(dashboard.leaderboard.entries.every((e) => e.alias.startsWith("Trader-"))).toBe(true);
    // No internal ids either: the client only used them as a list key.
    expect(serialized).not.toContain("user-1");
    expect(dashboard.leaderboard.userRank).toBe(2);
  });

  /**
   * Ranking used to load every user_points row for the season, and every users
   * row behind it, to return ten — unbounded work on a request path.
   */
  it("asks the database for a bounded, ranked page", async () => {
    const { getRewardsDashboard } = await import("./program");

    await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(supabaseAdmin.getSeasonLeaderboard).toHaveBeenCalledWith(
      expect.anything(),
      "season-1",
      "user-1",
      10,
    );
  });

  it("reports the caller's own eligible volume from their leaderboard row", async () => {
    supabaseAdmin.getSeasonLeaderboard.mockResolvedValue([
      { alias: "Trader-AAAA1111", eligibleVolume: 9000, isCurrentUser: false, rank: 1, xp: 10 },
      { alias: "Trader-BBBB2222", eligibleVolume: 4200, isCurrentUser: true, rank: 2, xp: 20 },
    ]);
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.season.eligibleVolume).toBe(4200);
  });

  it("reports referral XP from the ledger aggregate", async () => {
    supabaseAdmin.getSeasonXpTotals.mockResolvedValue({
      questXp: 300,
      referralBonusXp: 1500,
      totalXp: 2000,
      volumeXp: 200,
    });
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.season.referralXpTotal).toBe(1500);
  });

  it("returns referral linkage state in the dashboard summary", async () => {
    supabaseAdmin.getOrCreateRewardsUser.mockResolvedValue({
      id: "user-1",
      username: "user",
      wallet_address: null,
      referral_code: "CODE123",
      referred_by: "referrer-1",
    });
    const { getRewardsDashboard } = await import("./program");

    const dashboard = await getRewardsDashboard({ privyUserId: "privy-1" }, config());

    expect(dashboard.referral).toMatchObject({
      referralCode: "CODE123",
      hasReferrer: true,
      fundedReferralCount: 0,
      referredCount: 0,
    });
  });
});
