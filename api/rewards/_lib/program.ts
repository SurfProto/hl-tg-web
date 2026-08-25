import type {
  ReferralSummary,
  RewardsDashboard,
  RewardsProgramStatus,
  RewardsSyncStatus,
  WeeklyRafflePaused,
} from "../../../packages/types/src";
import { HttpError } from "../../onramp/_lib/http";
import { buildQuestSnapshot, buildTopTraderLeaderboard } from "./engine";
import { getRewardsConfig, type RewardsConfig } from "./config";
import {
  ensureReferralCode,
  getActiveSeason,
  getFillCheckpointStatus,
  getFundedReferralStats,
  getGrantedQuestIds,
  getOrCreateActiveSeason,
  getOrCreateRewardsUser,
  getRewardLedgerEntries,
  getSeasonLeaderboardRows,
  getSeasonXpTotals,
  getSuccessfulOnrampDeposits,
  getUserByReferralCode,
  setUserReferrer,
  type FillCheckpointStatus,
  type RewardsUserRow,
} from "./supabase-admin";

/**
 * The capabilities this build is willing to offer, sent to the client verbatim.
 *
 * The client renders from this rather than inferring what is available from
 * missing fields, so pausing a capability is one server-side edit and not a
 * coordinated release.
 */
const XP_ONLY_PROGRAM_STATUS: RewardsProgramStatus = {
  mode: "xp_only",
  usdcPayoutsEnabled: false,
  weeklyRaffleEnabled: false,
};

/**
 * No eligibility, no ranks, no winners — not "computed but withheld".
 *
 * Calculating a cohort nobody can be paid from would create exactly the
 * entitlement record this mode exists to stop producing.
 */
const WEEKLY_RAFFLE_PAUSED: WeeklyRafflePaused = { state: "paused" };

interface GetRewardsDashboardInput {
  privyUserId: string;
}

/** Older than this since the last successful ingestion and the numbers are stale. */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** Consecutive failed attempts before the dashboard admits something is wrong. */
const FAILURES_BEFORE_ERROR = 3;

type FillSummary = {
  cloid: string | null;
  fillKey: string;
  occurredAt: string;
  price: number;
  size: number;
};

type RawUserFill = {
  cloid?: string | null;
  hash: string;
  oid: number;
  px: number | string;
  sz: number | string;
  tid: number;
  time: number;
};

function normalizeReferralStartParam(startParam: string | null | undefined) {
  if (!startParam) {
    return null;
  }

  const normalized = startParam.trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/^ref[:_-]?/iu, "").toUpperCase();
}

function buildReferralSummary(
  user: RewardsUserRow,
  referralStats: { fundedReferralCount: number; referredCount: number },
): ReferralSummary {
  return {
    referralCode: user.referral_code ?? "",
    referredCount: referralStats.referredCount,
    fundedReferralCount: referralStats.fundedReferralCount,
    hasReferrer: Boolean(user.referred_by),
  };
}




/**
 * Read the rewards dashboard. Performs no exchange I/O and writes no reward state.
 *
 * This endpoint used to be a command wearing a query's clothes: opening the
 * Points screen could create a season, apply a referral, call Hyperliquid,
 * insert ledger rows, rewrite projections and attempt a USDC transfer. That
 * coupled whether a user could *see* their points to whether the exchange was
 * reachable, and made accounting completeness a function of who happened to
 * visit.
 *
 * All of that now happens in the scheduled worker. What remains here is
 * identity provisioning — get-or-create the user row and their referral code,
 * both idempotent and neither reward state — plus reads. A read may report that
 * its numbers are stale; it never makes them fresher.
 */
export async function getRewardsDashboard(
  input: GetRewardsDashboardInput,
  config = getRewardsConfig(),
): Promise<RewardsDashboard> {
  let user = await getOrCreateRewardsUser(config, {
    privyUserId: input.privyUserId,
  });
  user = await ensureReferralCode(config, user);

  // Never creates one. Before the first season exists there is nothing to
  // report, and inventing one because somebody opened a page is exactly the
  // race this release removes.
  const season = await getActiveSeason(config);
  if (!season) {
    return buildEmptyDashboard(user);
  }

  const now = new Date();
  const [deposits, referralStats, grantedQuestIds, xpTotals, rewardHistory, checkpoint] =
    await Promise.all([
      getSuccessfulOnrampDeposits(config, user.id, season.starts_at),
      getFundedReferralStats(config, user.id, season.starts_at, config.fundedDepositThresholdUsd),
      getGrantedQuestIds(config, user.id, season.id),
      getSeasonXpTotals(config, user.id, season.id),
      getRewardLedgerEntries(config, user.id, 150),
      getFillCheckpointStatus(config, user.id, season.id),
    ]);

  const questSnapshot = buildQuestSnapshot({
    currentTime: now.toISOString(),
    deposits,
    // Deliberately empty. Trades are ingested on a schedule, so the read path
    // has no fills to reason about and takes trade-derived quests from what the
    // ledger already granted instead.
    fills: [],
    firstTradeThresholdUsd: config.firstTradeThresholdUsd,
    fundedDepositThresholdUsd: config.fundedDepositThresholdUsd,
    grantedQuestIds,
    hasFundedReferral: referralStats.fundedReferralCount > 0,
  });

  const seasonLeaderboardRows = await getSeasonLeaderboardRows(config, season.id);
  const seasonLeaderboard = buildTopTraderLeaderboard({
    currentUserId: user.id,
    eligibleCohortSize: config.weeklyTopTraderCohortSize,
    rows: seasonLeaderboardRows,
  });

  const points = seasonLeaderboardRows.find((row) => row.userId === user.id);

  return {
    leaderboard: {
      entries: seasonLeaderboard.entries.slice(0, 10),
      userDistanceToCutoff: seasonLeaderboard.userDistanceToCutoff,
      userRank: seasonLeaderboard.userRank,
    },
    programStatus: XP_ONLY_PROGRAM_STATUS,
    quests: questSnapshot.quests,
    referral: buildReferralSummary(user, referralStats),
    // Cash history — held or genuinely paid — is reconciliation data, not
    // something to show a user next to a notice saying payouts are paused.
    rewardHistory: rewardHistory.filter((entry) => entry.rewardKind === "xp"),
    season: {
      eligibleVolume: points?.eligibleVolume ?? 0,
      endsAt: season.ends_at,
      leaderboardRank: seasonLeaderboard.userRank,
      name: season.name,
      questXpTotal: xpTotals.questXp,
      seasonId: season.id,
      startsAt: season.starts_at,
      volumeXpTotal: xpTotals.volumeXp,
      xpTotal: xpTotals.totalXp,
    },
    sync: buildSyncStatus(checkpoint, now),
    weeklyRaffle: WEEKLY_RAFFLE_PAUSED,
  };
}

/**
 * How fresh the numbers are, from the ingestion checkpoint.
 *
 * Carries no message on purpose. The reason a sync failed belongs in the run
 * log, where it can name an upstream status; putting it in a user-facing
 * response is how a Postgres constraint string ended up on the Points screen
 * once already.
 */
function buildSyncStatus(
  checkpoint: FillCheckpointStatus | null,
  now: Date,
): RewardsSyncStatus {
  if (!checkpoint || !checkpoint.lastSuccessAt) {
    // No successful pass yet. The totals shown are real but incomplete, which
    // a user who just traded needs told rather than shown a confident zero.
    return { lastSyncedAt: null, retentionRisk: false, state: "syncing" };
  }

  const ageMs = now.getTime() - new Date(checkpoint.lastSuccessAt).getTime();

  return {
    lastSyncedAt: checkpoint.lastSuccessAt,
    retentionRisk: checkpoint.retentionRisk,
    state:
      checkpoint.consecutiveFailures >= FAILURES_BEFORE_ERROR
        ? "error"
        : ageMs > STALE_AFTER_MS
          ? "stale"
          : "synced",
  };
}

/** Before any season exists there is nothing earned and nothing to sync. */
function buildEmptyDashboard(user: RewardsUserRow): RewardsDashboard {
  return {
    leaderboard: { entries: [], userDistanceToCutoff: 0, userRank: null },
    programStatus: XP_ONLY_PROGRAM_STATUS,
    quests: [],
    referral: buildReferralSummary(user, {
      fundedReferralCount: 0,
      referredCount: 0,
    }),
    rewardHistory: [],
    season: {
      eligibleVolume: 0,
      endsAt: new Date(0).toISOString(),
      leaderboardRank: null,
      name: "",
      questXpTotal: 0,
      seasonId: null,
      startsAt: new Date(0).toISOString(),
      volumeXpTotal: 0,
      xpTotal: 0,
    },
    sync: { lastSyncedAt: null, retentionRisk: false, state: "syncing" },
    weeklyRaffle: WEEKLY_RAFFLE_PAUSED,
  };
}

export async function applyReferralCode(
  privyUserId: string,
  referralCodeInput: string,
  config = getRewardsConfig(),
): Promise<ReferralSummary> {
  const referralCode = normalizeReferralStartParam(referralCodeInput);
  if (!referralCode) {
    throw new HttpError(400, "INVALID_REFERRAL_CODE", "Referral code is required");
  }

  let user = await getOrCreateRewardsUser(config, {
    privyUserId,
  });
  user = await ensureReferralCode(config, user);

  if (user.referred_by) {
    throw new HttpError(409, "REFERRAL_ALREADY_SET", "Referral code already applied");
  }

  if (user.referral_code === referralCode) {
    throw new HttpError(409, "SELF_REFERRAL_NOT_ALLOWED", "You cannot apply your own referral code");
  }

  const referrer = await getUserByReferralCode(config, referralCode);
  if (!referrer) {
    throw new HttpError(404, "REFERRAL_CODE_NOT_FOUND", "Referral code not found");
  }

  if (referrer.id === user.id) {
    throw new HttpError(409, "SELF_REFERRAL_NOT_ALLOWED", "You cannot apply your own referral code");
  }

  user = await setUserReferrer(config, user.id, referrer.id);
  const season = await getOrCreateActiveSeason(config);
  const referralStats = await getFundedReferralStats(
    config,
    user.id,
    season.starts_at,
    config.fundedDepositThresholdUsd,
  );

  return buildReferralSummary(user, referralStats);
}
