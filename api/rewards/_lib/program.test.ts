import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseAdmin = vi.hoisted(() => ({
  applyReferralCodeIfEligible: vi.fn(),
  ensureReferralCode: vi.fn(),
  getExistingVolumeXpFillKeys: vi.fn(),
  getFundedReferralStats: vi.fn(),
  getOrCreateActiveSeason: vi.fn(),
  getOrCreateRewardsUser: vi.fn(),
  getRewardLedgerEntries: vi.fn(),
  getRewardLedgerEntriesBySource: vi.fn(),
  getSeasonLeaderboardRows: vi.fn(),
  getSuccessfulOnrampDeposits: vi.fn(),
  getUserById: vi.fn(),
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
vi.mock("@repo/hyperliquid-sdk", () => ({
  HyperliquidClient: vi.fn(),
}));
vi.mock("./engine", () => ({
  buildQuestSnapshot: vi.fn(() => ({
    quests: [],
    completedQuestIds: [],
  })),
  buildTopTraderLeaderboard: vi.fn(() => ({
    entries: [],
    userDistanceToCutoff: null,
    userRank: null,
    cutoffVolume: 0,
  })),
  buildVolumeXpGrants: vi.fn(() => []),
  isAppAttributedFill: vi.fn(() => true),
}));

describe("syncRewardsDashboard", () => {
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
    supabaseAdmin.getRewardLedgerEntries.mockResolvedValue([
      {
        id: "ledger-1",
        amount: 25,
        asset: "USDC",
        createdAt: "2026-04-14T00:00:00.000Z",
        description: "Pending payout",
        metadata: null,
        postedAt: null,
        questId: null,
        rewardKind: "usdc",
        seasonId: "season-1",
        source: "quest",
        status: "pending",
        userId: "user-1",
        weekStart: "2026-04-14T00:00:00.000Z",
      },
    ]);
    supabaseAdmin.upsertUserPoints.mockResolvedValue(undefined);
    supabaseAdmin.upsertWeeklyReward.mockResolvedValue(undefined);
    supabaseAdmin.getSeasonLeaderboardRows.mockResolvedValue([]);
    supabaseAdmin.getWeeklyVolumeRows.mockResolvedValue([]);
    supabaseAdmin.getUsersByIds.mockResolvedValue([]);
    supabaseAdmin.getRewardLedgerEntriesBySource.mockResolvedValue([]);
    supabaseAdmin.getUserPointsForSeason.mockResolvedValue({ xp: 0 });
    payout.hasRewardsTreasury.mockReturnValue(true);
  });

  it("logs and leaves pending USDC entries untouched when the user has no wallet", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { syncRewardsDashboard } = await import("./program");

    const dashboard = await syncRewardsDashboard(
      {
        privyUserId: "privy-1",
        username: "user",
        walletAddress: null,
      },
      {
        firstTradeThresholdUsd: 50,
        fundedDepositThresholdUsd: 50,
        hyperliquidTestnet: false,
        privyAppId: null,
        rafflePrizeAmounts: [100],
        rewardsAdminKey: "admin-secret",
        supabaseServiceRoleKey: "service-role",
        supabaseUrl: "https://example.supabase.co",
        treasuryPrivateKey: "0x1234",
        weeklyRewardPoolUsd: 100,
        weeklyTopTraderCohortSize: 10,
        weeklyWinnerCount: 1,
        xpPerUsd: 1,
      },
    );

    expect(consoleError).toHaveBeenCalledWith(
      "[rewards] Skipping pending USDC payout for user user-1: no wallet address",
    );
    expect(dashboard.rewardHistory).toHaveLength(1);
    expect(dashboard.rewardHistory[0]).toMatchObject({
      id: "ledger-1",
      status: "pending",
      rewardKind: "usdc",
    });
    expect(payout.sendRewardUsdc).not.toHaveBeenCalled();
  });

  it("returns referral linkage state in the dashboard summary", async () => {
    supabaseAdmin.getOrCreateRewardsUser.mockResolvedValue({
      id: "user-1",
      username: "user",
      wallet_address: null,
      referral_code: "CODE123",
      referred_by: "referrer-1",
    });
    const { syncRewardsDashboard } = await import("./program");

    const dashboard = await syncRewardsDashboard(
      {
        privyUserId: "privy-1",
        referralStartParam: null,
        username: "user",
        walletAddress: null,
      },
      {
        firstTradeThresholdUsd: 50,
        fundedDepositThresholdUsd: 50,
        hyperliquidTestnet: false,
        privyAppId: null,
        rafflePrizeAmounts: [100],
        rewardsAdminKey: "admin-secret",
        supabaseServiceRoleKey: "service-role",
        supabaseUrl: "https://example.supabase.co",
        treasuryPrivateKey: null,
        weeklyRewardPoolUsd: 100,
        weeklyTopTraderCohortSize: 10,
        weeklyWinnerCount: 1,
        xpPerUsd: 1,
      },
    );

    expect(dashboard.referral).toMatchObject({
      referralCode: "CODE123",
      hasReferrer: true,
      fundedReferralCount: 0,
      referredCount: 0,
    });
  });
});

describe("runWeeklyRaffle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseAdmin.getOrCreateActiveSeason.mockResolvedValue({
      id: "season-1",
      starts_at: "2026-04-01T00:00:00.000Z",
      ends_at: "2026-05-01T00:00:00.000Z",
      name: "Season 1",
    });
  });

  it("returns existing winners without creating duplicates", async () => {
    const existingWinners = [
      {
        id: "ledger-1",
        amount: 100,
        asset: "USDC",
        createdAt: "2026-04-14T00:00:00.000Z",
        description: "Winner",
        metadata: null,
        postedAt: null,
        questId: null,
        rewardKind: "raffle",
        seasonId: "season-1",
        source: "weekly_raffle",
        status: "pending",
        userId: "user-1",
        weekStart: "2026-04-14T00:00:00.000Z",
      },
    ];
    supabaseAdmin.getRewardLedgerEntriesBySource.mockResolvedValue(existingWinners);
    const { runWeeklyRaffle } = await import("./program");

    const result = await runWeeklyRaffle(
      { weekStart: "2026-04-14T00:00:00.000Z" },
      {
        firstTradeThresholdUsd: 50,
        fundedDepositThresholdUsd: 50,
        hyperliquidTestnet: false,
        privyAppId: null,
        rafflePrizeAmounts: [100],
        rewardsAdminKey: "admin-secret",
        supabaseServiceRoleKey: "service-role",
        supabaseUrl: "https://example.supabase.co",
        treasuryPrivateKey: null,
        weeklyRewardPoolUsd: 100,
        weeklyTopTraderCohortSize: 10,
        weeklyWinnerCount: 1,
        xpPerUsd: 1,
      },
    );

    expect(result).toEqual({
      seasonId: "season-1",
      weekStart: "2026-04-14T00:00:00.000Z",
      winners: existingWinners,
    });
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
  });
});
