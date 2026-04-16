import type {
  QuestId,
  ReferralSummary,
  RewardsDashboard,
  RewardKind,
  RewardLedgerEntry,
  WeeklyRaffleSnapshot,
} from "../../../packages/types/src";
import { HttpError } from "../../onramp/_lib/http";
import {
  buildQuestSnapshot,
  buildTopTraderLeaderboard,
  buildVolumeXpGrants,
  isAppAttributedFill,
} from "./engine";
import { getRewardsConfig, type RewardsConfig } from "./config";
import {
  applyReferralCodeIfEligible,
  ensureReferralCode,
  getExistingVolumeXpFillKeys,
  getFundedReferralStats,
  getOrCreateActiveSeason,
  getOrCreateRewardsUser,
  getRewardLedgerEntries,
  getRewardLedgerEntriesBySource,
  getSeasonLeaderboardRows,
  getSuccessfulOnrampDeposits,
  getUserById,
  getUserByReferralCode,
  getUserPointsForSeason,
  getUsersByIds,
  getWeeklyVolumeRows,
  patchWeeklyReward,
  setUserReferrer,
  upsertRewardLedgerEntries,
  upsertUserPoints,
  upsertWeeklyReward,
  updateRewardLedgerStatus,
  type RewardsUserRow,
} from "./supabase-admin";

interface SyncRewardsDashboardInput {
  privyUserId: string;
  referralStartParam?: string | null;
  username?: string | null;
  walletAddress?: string | null;
}

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

function getWeekStartIso(value: Date) {
  const weekStart = new Date(value);
  const dayOffset = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart.toISOString();
}

function getWeekEndIso(weekStartIso: string) {
  const weekEnd = new Date(weekStartIso);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return weekEnd.toISOString();
}

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

async function getFillSummaries(config: RewardsConfig, walletAddress: string, seasonStart: string) {
  const response = await fetch(
    config.hyperliquidTestnet
      ? "https://api.hyperliquid-testnet.xyz/info"
      : "https://api.hyperliquid.xyz/info",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "userFills",
        user: walletAddress,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Hyperliquid fills request failed with status ${response.status}`);
  }

  const fills = (await response.json()) as RawUserFill[];
  return fills
    .filter((fill) => new Date(fill.time).toISOString() >= seasonStart)
    .map(
      (fill): FillSummary => ({
        cloid: fill.cloid ?? null,
        fillKey: `${fill.tid}:${fill.hash}:${fill.oid}`,
        occurredAt: new Date(fill.time).toISOString(),
        price: Number(fill.px),
        size: Number(fill.sz),
      }),
    );
}

async function loadPayoutModule() {
  return import("./payout.js");
}

async function canSendRewards(config: RewardsConfig) {
  return Boolean(config.treasuryPrivateKey);
}

async function sendPendingRewardUsdc(
  config: RewardsConfig,
  input: { amount: number; destination: string },
) {
  const { sendRewardUsdc } = await loadPayoutModule();
  return sendRewardUsdc(config, input);
}

function sumAmounts(entries: RewardLedgerEntry[], predicate: (entry: RewardLedgerEntry) => boolean) {
  return entries
    .filter(predicate)
    .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
}

function buildQuestRewardEntries(args: {
  questIds: QuestId[];
  seasonId: string;
  userId: string;
  weekStart: string;
}) {
  const definitions: Record<
    QuestId,
    { description: string; rewards: Array<{ amount: number; kind: RewardKind; asset: string | null }> }
  > = {
    first_deposit: {
      description: "Completed your first qualifying deposit.",
      rewards: [
        { amount: 5, asset: "USDC", kind: "usdc" },
        { amount: 500, asset: null, kind: "xp" },
      ],
    },
    first_trade: {
      description: "Completed your first qualifying trade.",
      rewards: [
        { amount: 3, asset: "USDC", kind: "usdc" },
        { amount: 300, asset: null, kind: "xp" },
      ],
    },
    referral_funded_friend: {
      description: "A referred friend completed a funded deposit.",
      rewards: [
        { amount: 5, asset: "USDC", kind: "usdc" },
        { amount: 500, asset: null, kind: "xp" },
      ],
    },
    second_deposit_7d: {
      description: "Completed a second qualifying deposit within 7 days.",
      rewards: [{ amount: 250, asset: null, kind: "xp" }],
    },
  };

  return args.questIds.flatMap((questId) =>
    definitions[questId].rewards.map((reward) => ({
      amount: reward.amount,
      asset: reward.asset,
      description: definitions[questId].description,
      idempotencyKey: `quest:${args.seasonId}:${args.userId}:${questId}:${reward.kind}`,
      metadata: null,
      postedAt: reward.kind === "xp" ? new Date().toISOString() : null,
      questId,
      rewardKind: reward.kind,
      seasonId: args.seasonId,
      source: "quest",
      status: reward.kind === "xp" ? "posted" : "pending",
      userId: args.userId,
      weekStart: args.weekStart,
    })),
  );
}

function buildReferralBonusEntries(args: {
  seasonId: string;
  userId: string;
  weekStart: string;
}) {
  return [
    {
      amount: 5,
      asset: "USDC",
      description: "Referral welcome bonus for completing your first funded deposit.",
      idempotencyKey: `referral_bonus:${args.seasonId}:${args.userId}:usdc`,
      metadata: null,
      postedAt: null,
      questId: null,
      rewardKind: "usdc" as const,
      seasonId: args.seasonId,
      source: "referral_bonus",
      status: "pending" as const,
      userId: args.userId,
      weekStart: args.weekStart,
    },
    {
      amount: 500,
      asset: null,
      description: "Referral welcome bonus XP.",
      idempotencyKey: `referral_bonus:${args.seasonId}:${args.userId}:xp`,
      metadata: null,
      postedAt: new Date().toISOString(),
      questId: null,
      rewardKind: "xp" as const,
      seasonId: args.seasonId,
      source: "referral_bonus",
      status: "posted" as const,
      userId: args.userId,
      weekStart: args.weekStart,
    },
  ];
}

async function settlePendingUsdcEntries(
  config: RewardsConfig,
  user: RewardsUserRow,
  entries: RewardLedgerEntry[],
) {
  if (!user.wallet_address) {
    console.error(`[rewards] Skipping pending USDC payout for user ${user.id}: no wallet address`);
    return entries;
  }

  if (!(await canSendRewards(config))) {
    return entries;
  }

  const nextEntries = [...entries];
  for (let index = 0; index < nextEntries.length; index += 1) {
    const entry = nextEntries[index];
    if (entry.rewardKind !== "usdc" || entry.status !== "pending") {
      continue;
    }

    try {
      const transfer = await sendPendingRewardUsdc(config, {
        amount: Number(entry.amount),
        destination: user.wallet_address,
      });
      nextEntries[index] = await updateRewardLedgerStatus(config, entry.id, {
        metadata: {
          ...(entry.metadata ?? {}),
          transfer,
        },
        postedAt: new Date().toISOString(),
        status: "posted",
      });
    } catch (error) {
      nextEntries[index] = await updateRewardLedgerStatus(config, entry.id, {
        metadata: {
          ...(entry.metadata ?? {}),
          error: error instanceof Error ? error.message : "Reward payout failed",
        },
        status: "failed",
      });
    }
  }

  return nextEntries;
}

function buildWeeklyRaffleSnapshot(args: {
  currentUserId: string;
  leaderboard: ReturnType<typeof buildTopTraderLeaderboard>;
  weekStart: string;
  winnerCount: number;
  winners: RewardLedgerEntry[];
}) {
  const weekStart = args.weekStart;
  const weekEnd = getWeekEndIso(weekStart);
  const winnerEntries = args.winners.map((entry) => ({
    displayName:
      String(entry.metadata?.displayName ?? entry.metadata?.username ?? "Trader"),
    prizeUsdc: Number(entry.amount),
    userId: String(entry.metadata?.winnerUserId ?? entry.userId),
  }));
  const currentUser = args.leaderboard.entries.find(
    (entry) => entry.userId === args.currentUserId,
  );

  return {
    cohortSize: args.leaderboard.entries.filter((entry) => entry.raffleEligible).length,
    cutoffVolume: args.leaderboard.cutoffVolume,
    userDistanceToCutoff: args.leaderboard.userDistanceToCutoff,
    userEligibleVolume: currentUser?.eligibleVolume ?? 0,
    userIsEligible: currentUser?.raffleEligible ?? false,
    userRank: args.leaderboard.userRank,
    weekEnd,
    weekStart,
    winnerCount: args.winnerCount,
    winners: winnerEntries,
  } satisfies WeeklyRaffleSnapshot;
}

function randomIndex(limit: number) {
  if (limit <= 1) {
    return 0;
  }

  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % limit;
  }

  return Math.floor(Math.random() * limit);
}

function drawWinners<T>(entries: T[], count: number) {
  const pool = [...entries];
  const winners: T[] = [];

  while (pool.length > 0 && winners.length < count) {
    const index = randomIndex(pool.length);
    winners.push(pool[index]);
    pool.splice(index, 1);
  }

  return winners;
}

export async function syncRewardsDashboard(
  input: SyncRewardsDashboardInput,
  config = getRewardsConfig(),
): Promise<RewardsDashboard> {
  let user = await getOrCreateRewardsUser(config, {
    privyUserId: input.privyUserId,
    username: input.username ?? null,
    walletAddress: input.walletAddress ?? null,
  });
  user = await ensureReferralCode(config, user);
  user = await applyReferralCodeIfEligible(config, {
    referralCode: normalizeReferralStartParam(input.referralStartParam),
    user,
  });

  const season = await getOrCreateActiveSeason(config);
  const now = new Date();
  const weekStart = getWeekStartIso(now);
  const deposits = await getSuccessfulOnrampDeposits(config, user.id, season.starts_at);
  const fills =
    user.wallet_address != null
      ? await getFillSummaries(config, user.wallet_address, season.starts_at)
      : [];
  const referralStats = await getFundedReferralStats(
    config,
    user.id,
    season.starts_at,
    config.fundedDepositThresholdUsd,
  );

  const questSnapshot = buildQuestSnapshot({
    currentTime: now.toISOString(),
    deposits,
    fills,
    firstTradeThresholdUsd: config.firstTradeThresholdUsd,
    fundedDepositThresholdUsd: config.fundedDepositThresholdUsd,
    hasFundedReferral: referralStats.fundedReferralCount > 0,
  });

  const existingVolumeXpFillKeys = await getExistingVolumeXpFillKeys(config, user.id, season.id);
  const volumeXpGrants = buildVolumeXpGrants({
    existingFillKeys: existingVolumeXpFillKeys,
    fills,
    seasonId: season.id,
    userId: user.id,
    weekStart,
    xpPerUsd: config.xpPerUsd,
  });

  const ledgerEntriesToUpsert = [
    ...buildQuestRewardEntries({
      questIds: questSnapshot.completedQuestIds,
      seasonId: season.id,
      userId: user.id,
      weekStart,
    }),
    ...volumeXpGrants.map((grant) => ({
      amount: grant.xp,
      asset: null,
      description: `Trading volume XP for ${grant.volumeUsd.toFixed(2)} USD of app volume.`,
      idempotencyKey: `volume_xp:${season.id}:${user.id}:${grant.fillKey}`,
      metadata: {
        fillKey: grant.fillKey,
        volumeUsd: grant.volumeUsd,
      },
      postedAt: new Date().toISOString(),
      questId: null,
      rewardKind: "xp" as const,
      seasonId: season.id,
      source: "volume_xp",
      status: "posted" as const,
      userId: user.id,
      weekStart,
    })),
  ];

  const firstDepositCompleted = questSnapshot.completedQuestIds.includes("first_deposit");
  if (firstDepositCompleted && user.referred_by) {
    ledgerEntriesToUpsert.push(
      ...buildReferralBonusEntries({
        seasonId: season.id,
        userId: user.id,
        weekStart,
      }),
    );

    const referrer = await getUserById(config, user.referred_by);
    if (referrer) {
      ledgerEntriesToUpsert.push(
        ...buildQuestRewardEntries({
          questIds: ["referral_funded_friend"],
          seasonId: season.id,
          userId: referrer.id,
          weekStart,
        }),
      );
    }
  }

  await upsertRewardLedgerEntries(config, ledgerEntriesToUpsert);

  let rewardHistory = await getRewardLedgerEntries(config, user.id, 150);
  rewardHistory = await settlePendingUsdcEntries(config, user, rewardHistory);

  const appEligibleVolume = fills
    .filter((fill) => isAppAttributedFill(fill))
    .reduce((sum, fill) => sum + Math.abs(fill.price) * Math.abs(fill.size), 0);
  const weeklyEligibleVolume = fills
    .filter((fill) => fill.occurredAt >= weekStart)
    .filter((fill) => isAppAttributedFill(fill))
    .reduce((sum, fill) => sum + Math.abs(fill.price) * Math.abs(fill.size), 0);

  const questXpTotal = sumAmounts(
    rewardHistory,
    (entry) => entry.rewardKind === "xp" && entry.source === "quest",
  );
  const volumeXpTotal = sumAmounts(
    rewardHistory,
    (entry) => entry.rewardKind === "xp" && entry.source === "volume_xp",
  );
  const referralBonusXpTotal = sumAmounts(
    rewardHistory,
    (entry) => entry.rewardKind === "xp" && entry.source === "referral_bonus",
  );
  const totalXp = questXpTotal + volumeXpTotal + referralBonusXpTotal;

  await upsertUserPoints(config, {
    referralVolume: referralStats.fundedReferralVolume,
    seasonId: season.id,
    totalVolume: appEligibleVolume,
    userId: user.id,
    xp: totalXp,
  });
  await upsertWeeklyReward(config, {
    seasonId: season.id,
    userId: user.id,
    userVolume: weeklyEligibleVolume,
    weekStart,
  });

  const seasonLeaderboardRows = await getSeasonLeaderboardRows(config, season.id);
  const seasonLeaderboard = buildTopTraderLeaderboard({
    currentUserId: user.id,
    eligibleCohortSize: config.weeklyTopTraderCohortSize,
    rows: seasonLeaderboardRows,
  });

  const weeklyRows = await getWeeklyVolumeRows(config, season.id, weekStart);
  const weeklyUsers = await getUsersByIds(
    config,
    [...new Set(weeklyRows.map((row) => row.user_id))],
  );
  const weeklyUsersById = new Map(weeklyUsers.map((candidate) => [candidate.id, candidate]));
  const xpByUserId = new Map(seasonLeaderboardRows.map((row) => [row.userId, row.xp]));
  const weeklyLeaderboard = buildTopTraderLeaderboard({
    currentUserId: user.id,
    eligibleCohortSize: config.weeklyTopTraderCohortSize,
    rows: weeklyRows.map((row) => ({
      displayName:
        weeklyUsersById.get(row.user_id)?.username ??
        weeklyUsersById.get(row.user_id)?.wallet_address?.slice(0, 6) ??
        "Trader",
      eligibleVolume: Number(row.user_volume ?? 0),
      userId: row.user_id,
      xp: xpByUserId.get(row.user_id) ?? 0,
    })),
  });

  const weeklyWinners = await getRewardLedgerEntriesBySource(config, {
    seasonId: season.id,
    source: "weekly_raffle",
    weekStart,
  });
  const weeklySnapshot = buildWeeklyRaffleSnapshot({
    currentUserId: user.id,
    leaderboard: weeklyLeaderboard,
    weekStart,
    winnerCount: config.weeklyWinnerCount,
    winners: weeklyWinners,
  });

  for (const entry of weeklyLeaderboard.entries) {
    const weeklyRow = weeklyRows.find((row) => row.user_id === entry.userId);
    if (!weeklyRow) {
      continue;
    }

    await patchWeeklyReward(config, weeklyRow.id, {
      raffle_eligible: entry.raffleEligible,
      raffle_rank: entry.rank,
    });
  }

  const currentPoints = await getUserPointsForSeason(config, user.id, season.id);

  return {
    leaderboard: {
      entries: seasonLeaderboard.entries.slice(0, 10),
      userDistanceToCutoff: seasonLeaderboard.userDistanceToCutoff,
      userRank: seasonLeaderboard.userRank,
    },
    quests: questSnapshot.quests,
    referral: {
      ...buildReferralSummary(user, referralStats),
    },
    rewardHistory,
    season: {
      eligibleVolume: appEligibleVolume,
      endsAt: season.ends_at,
      leaderboardRank: seasonLeaderboard.userRank,
      name: season.name,
      questXpTotal,
      seasonId: season.id,
      startsAt: season.starts_at,
      volumeXpTotal,
      xpTotal: Number(currentPoints?.xp ?? totalXp),
    },
    weeklyRaffle: weeklySnapshot,
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
    username: null,
    walletAddress: null,
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

export async function runWeeklyRaffle(
  input?: { weekStart?: string | null },
  config = getRewardsConfig(),
) {
  const season = await getOrCreateActiveSeason(config);
  const weekStart = input?.weekStart ?? getWeekStartIso(new Date());
  const existingWinners = await getRewardLedgerEntriesBySource(config, {
    seasonId: season.id,
    source: "weekly_raffle",
    weekStart,
  });
  if (existingWinners.length > 0) {
    return {
      seasonId: season.id,
      weekStart,
      winners: existingWinners,
    };
  }

  const weeklyRows = await getWeeklyVolumeRows(config, season.id, weekStart);
  const users = await getUsersByIds(
    config,
    [...new Set(weeklyRows.map((row) => row.user_id))],
  );
  const usersById = new Map(users.map((user) => [user.id, user]));
  const leaderboard = buildTopTraderLeaderboard({
    currentUserId: weeklyRows[0]?.user_id ?? "",
    eligibleCohortSize: config.weeklyTopTraderCohortSize,
    rows: weeklyRows.map((row) => ({
      displayName:
        usersById.get(row.user_id)?.username ??
        usersById.get(row.user_id)?.wallet_address?.slice(0, 6) ??
        "Trader",
      eligibleVolume: Number(row.user_volume ?? 0),
      userId: row.user_id,
      xp: 0,
    })),
  });
  const eligibleEntries = leaderboard.entries.filter((entry) => entry.raffleEligible);
  const drawnWinners = drawWinners(
    eligibleEntries,
    Math.min(config.weeklyWinnerCount, eligibleEntries.length),
  );
  const nowIso = new Date().toISOString();

  const upserted = await upsertRewardLedgerEntries(
    config,
    drawnWinners.map((winner, index) => ({
      amount: config.rafflePrizeAmounts[index] ?? 0,
      asset: "USDC",
      description: `Weekly raffle prize for rank cohort ending ${weekStart}.`,
      idempotencyKey: `weekly_raffle:${season.id}:${weekStart}:${winner.userId}`,
      metadata: {
        displayName: winner.displayName,
        rank: winner.rank,
        winnerUserId: winner.userId,
      },
      postedAt: null,
      questId: null,
      rewardKind: "raffle",
      seasonId: season.id,
      source: "weekly_raffle",
      status: "pending",
      userId: winner.userId,
      weekStart,
    })),
  );

  for (const row of weeklyRows) {
    const leaderboardEntry = leaderboard.entries.find((entry) => entry.userId === row.user_id);
    const winnerEntry = upserted.find((entry) => entry.userId === row.user_id);
    await patchWeeklyReward(config, row.id, {
      drawn_at: nowIso,
      raffle_eligible: leaderboardEntry?.raffleEligible ?? false,
      raffle_prize: String(winnerEntry?.amount ?? 0),
      raffle_rank: leaderboardEntry?.rank ?? null,
    });
  }

  if (await canSendRewards(config)) {
    for (const entry of upserted) {
      const winner = usersById.get(entry.userId);
      if (!winner?.wallet_address) {
        continue;
      }

      try {
        const transfer = await sendPendingRewardUsdc(config, {
          amount: Number(entry.amount),
          destination: winner.wallet_address,
        });
        await updateRewardLedgerStatus(config, entry.id, {
          metadata: {
            ...(entry.metadata ?? {}),
            transfer,
          },
          postedAt: nowIso,
          status: "posted",
        });
      } catch (error) {
        await updateRewardLedgerStatus(config, entry.id, {
          metadata: {
            ...(entry.metadata ?? {}),
            error: error instanceof Error ? error.message : "Weekly raffle payout failed",
          },
          status: "failed",
        });
      }
    }
  }

  return {
    seasonId: season.id,
    weekStart,
    winners: await getRewardLedgerEntriesBySource(config, {
      seasonId: season.id,
      source: "weekly_raffle",
      weekStart,
    }),
  };
}
