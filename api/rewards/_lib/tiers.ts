import type { RewardsRank, RewardsTier } from "../../../packages/types/src";

/**
 * Ranks, and the multiplier each one earns.
 *
 * Thresholds live in code rather than in the database on purpose: they are
 * program policy, they will be tuned, and tuning them should show up in a diff
 * and a review rather than in a row somebody changed.
 *
 * Rank comes from cumulative season XP, not from leaderboard position. Position
 * is zero-sum — as the cohort grows most users watch their standing fall while
 * doing nothing wrong, which is demoralising exactly when you are trying to
 * keep new people. A threshold is achievable and nobody else's activity can
 * take it away. The leaderboard stays competitive; rank does not.
 */
export interface TierDefinition {
  rank: RewardsRank;
  minSeasonXp: number;
  multiplier: number;
}

/** Ascending by threshold. `resolveTier` relies on that order. */
export const TIERS: readonly TierDefinition[] = [
  { minSeasonXp: 0, multiplier: 1, rank: "basecamp" },
  { minSeasonXp: 2_500, multiplier: 1.1, rank: "climber" },
  { minSeasonXp: 10_000, multiplier: 1.25, rank: "ridge" },
  { minSeasonXp: 40_000, multiplier: 1.5, rank: "summit" },
  { minSeasonXp: 150_000, multiplier: 2, rank: "peak" },
];

/** The tier a season XP total earns. Never returns undefined — Basecamp is the floor. */
export function resolveTier(seasonXp: number): TierDefinition {
  let current = TIERS[0]!;

  for (const tier of TIERS) {
    if (seasonXp >= tier.minSeasonXp) {
      current = tier;
    }
  }

  return current;
}

/**
 * The full rank picture for a user, including how far the next one is.
 *
 * `xpToNextRank` is null at the top rather than zero: zero would render as
 * "0 XP to go", which reads as being on the cusp of something rather than
 * having arrived.
 */
export function buildTier(seasonXp: number): RewardsTier {
  const current = resolveTier(seasonXp);
  const next = TIERS.find((tier) => tier.minSeasonXp > current.minSeasonXp) ?? null;

  return {
    multiplier: current.multiplier,
    nextRank: next?.rank ?? null,
    nextRankAtXp: next?.minSeasonXp ?? null,
    rank: current.rank,
    xpToNextRank: next ? Math.max(0, next.minSeasonXp - seasonXp) : null,
  };
}

/**
 * The bonus XP a grant earns at a given tier, as a whole number.
 *
 * Returned separately from the base amount rather than folded into it, because
 * it is written to the ledger as its own row. Multiplying inside the aggregate
 * would make every historical total a function of today's rank, so promoting a
 * user would silently rewrite what they earned last week and the ledger would
 * stop being the source of truth it is for everything else.
 *
 * Floored, so the bonus can never round a grant up into XP nobody earned.
 */
export function tierBonusFor(baseXp: number, multiplier: number): number {
  if (baseXp <= 0 || multiplier <= 1) {
    return 0;
  }

  return Math.floor(baseXp * multiplier) - baseXp;
}
