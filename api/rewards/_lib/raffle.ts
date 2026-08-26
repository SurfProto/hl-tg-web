import { HttpError } from "../../onramp/_lib/http";
import { buildTopTraderLeaderboard } from "./engine";
import type { RewardsConfig } from "./config";
import {
  claimWeeklyRaffleRun,
  completeWeeklyRaffleRun,
  getOrCreateActiveSeason,
  getRewardLedgerEntriesBySource,
  getUsersByIds,
  getWeeklyVolumeRows,
  patchWeeklyReward,
  upsertRewardLedgerEntries,
} from "./supabase-admin";
import { getWeekStartIso } from "./weeks";

/**
 * Dormant. Not reachable from any deployed handler.
 *
 * The rewards program is XP-only, and `/api/rewards/weekly-raffle` refuses with
 * REWARDS_XP_ONLY before it reaches any of this. The draw lives here rather than
 * in `program.ts` for one specific reason: `program.ts` is what the dashboard
 * imports, and the only cheap way to prove a dashboard request cannot reach a
 * payout is for its module graph not to contain one. Moving the raffle out is
 * what lets `server-imports.test.ts` assert that as a flat fact.
 *
 * The serialisation and unbiased-draw work below is kept because it was correct
 * and separately tested; it is the *payout* leg that was removed, since a
 * relaunch has to rebuild that against the gates in
 * docs/superpowers/specs/2026-08-24-points-xp-only-hardening-design.md rather
 * than re-enable it as it stood.
 */

/**
 * Uniform index in [0, limit).
 *
 * `getRandomValues()[0] % limit` is biased towards low indices whenever limit
 * does not divide 2^32, which is not acceptable for a draw that pays out real
 * USDC. Rejection sampling discards the values in the final partial bucket. The
 * old Math.random() fallback is gone: on Node 20 globalThis.crypto is always
 * present, so it was unreachable, and a non-cryptographic prize draw should
 * fail rather than quietly happen.
 */
function randomIndex(limit: number) {
  if (limit <= 1) {
    return 0;
  }

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure randomness is unavailable; refusing to draw raffle winners");
  }

  const values = new Uint32Array(1);
  const range = 2 ** 32;
  const limitOfUnbiasedRange = range - (range % limit);

  // Expected iterations < 2 for any limit.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    globalThis.crypto.getRandomValues(values);
    if (values[0] < limitOfUnbiasedRange) {
      return values[0] % limit;
    }
  }

  throw new Error("Failed to draw an unbiased random index");
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

export async function runWeeklyRaffle(
  input: { weekStart?: string | null } | undefined,
  config: RewardsConfig,
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

  // Prizes are handed out by draw index, so a short prize list silently paid
  // later winners nothing. Refuse before drawing rather than after.
  if (config.rafflePrizeAmounts.length < config.weeklyWinnerCount) {
    throw new HttpError(
      500,
      "RAFFLE_MISCONFIGURED",
      `rafflePrizeAmounts has ${config.rafflePrizeAmounts.length} entries but weeklyWinnerCount is ${config.weeklyWinnerCount}`,
    );
  }

  // Claim the week before drawing. The read above is not enough on its own:
  // two concurrent runs both saw no winners and both drew, and the per-user
  // ledger idempotency key merged the two draws instead of rejecting one.
  const claimed = await claimWeeklyRaffleRun(config, season.id, weekStart);
  if (!claimed) {
    return {
      alreadyRunning: true,
      seasonId: season.id,
      weekStart,
      winners: [],
    };
  }

  try {
    return await drawWeeklyRaffle(config, season, weekStart);
  } catch (error) {
    await completeWeeklyRaffleRun(
      config,
      season.id,
      weekStart,
      0,
      error instanceof Error ? error.message : "Weekly raffle failed",
    );
    throw error;
  }
}

async function drawWeeklyRaffle(
  config: RewardsConfig,
  season: { id: string },
  weekStart: string,
) {
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

  // No payout leg. Drawn rows stay 'pending' for a relaunch that can settle
  // them with durable attempt state, and the XP-only migration parks anything
  // already sitting here as 'held'.
  const winners = await getRewardLedgerEntriesBySource(config, {
    seasonId: season.id,
    source: "weekly_raffle",
    weekStart,
  });

  await completeWeeklyRaffleRun(config, season.id, weekStart, winners.length);

  return {
    seasonId: season.id,
    weekStart,
    winners,
  };
}
