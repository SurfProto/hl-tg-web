import type { RewardsConfig } from "./config";
import {
  getReferralMilestones,
  upsertRewardLedgerEntries,
  type ReferralMilestone,
  type RewardLedgerInsertInput,
} from "./supabase-admin";

/**
 * Referral rungs, and what each pays.
 *
 * Weights are expressed against a unit rather than as literal amounts, so
 * retuning the programme means changing one number rather than six.
 *
 * There are two schedules, not one. Counting a dry invite as the zero it pays,
 * the referrer runs 0 / 0 / 3 / 6 and the referee 0 / 1 / 1 / 2. The moat
 * design used to describe both as a single "0 / 1 / 3 / 6" ladder, which is
 * neither of them — it cannot produce the referee's 500 at `retained`.
 *
 * Two thirds of the referrer's total weight sits on `retained`. That is
 * deliberate: it is the only rung that cannot be compressed into an afternoon,
 * so putting the money there prices a real trader above a warm body.
 *
 * A dry invite — an account that exists and has done nothing — appears nowhere.
 * An empty wallet costs an attacker nothing, and if XP ever backs an
 * allocation, paying for one means paying out cap table for a bot.
 */
const REFERRAL_UNIT_XP = 250;

const MILESTONE_WEIGHTS: Record<ReferralMilestone, { referee: number; referrer: number }> = {
  funded: { referee: 1, referrer: 0 },
  retained: { referee: 2, referrer: 6 },
  traded: { referee: 1, referrer: 3 },
};

const MILESTONE_COPY: Record<ReferralMilestone, string> = {
  funded: "A friend you invited funded their account.",
  retained: "A friend you invited is still trading a month on.",
  traded: "A friend you invited started trading.",
};

const REFEREE_COPY: Record<ReferralMilestone, string> = {
  funded: "Welcome bonus for funding your account.",
  retained: "Bonus for still trading a month in.",
  traded: "Bonus for your first trades.",
};

/**
 * Ledger rows for every referral rung currently earned.
 *
 * Every qualifying rung is emitted on every run rather than only newly earned
 * ones, and the keys carry the *referee* rather than only the referrer. That
 * pairing is what fixes the old behaviour: the previous key was
 * `quest:{season}:{referrer}:referral_funded_friend:xp`, one row per referrer
 * per season, so a referrer who brought ten funded friends was paid for one.
 *
 * No season appears in the key either. A referral milestone happens once in a
 * user's life, not once per season, and re-granting it every eight weeks would
 * turn the funnel into a subscription.
 */
export function buildReferralMilestoneEntries(args: {
  milestones: Array<{ milestone: ReferralMilestone; refereeId: string; referrerId: string }>;
  seasonId: string;
  weekStart: string;
}): RewardLedgerInsertInput[] {
  const entries: RewardLedgerInsertInput[] = [];

  for (const { milestone, refereeId, referrerId } of args.milestones) {
    const weight = MILESTONE_WEIGHTS[milestone];
    if (!weight) {
      continue;
    }

    if (weight.referrer > 0) {
      entries.push({
        amount: weight.referrer * REFERRAL_UNIT_XP,
        asset: null,
        description: MILESTONE_COPY[milestone],
        idempotencyKey: `referral:${milestone}:${refereeId}:referrer`,
        metadata: { milestone, refereeId },
        postedAt: new Date().toISOString(),
        questId: null,
        rewardKind: "xp",
        seasonId: args.seasonId,
        source: "referral",
        status: "posted",
        userId: referrerId,
        weekStart: args.weekStart,
      });
    }

    if (weight.referee > 0) {
      entries.push({
        amount: weight.referee * REFERRAL_UNIT_XP,
        asset: null,
        description: REFEREE_COPY[milestone],
        idempotencyKey: `referral:${milestone}:${refereeId}:referee`,
        metadata: { milestone, referrerId },
        postedAt: new Date().toISOString(),
        questId: null,
        rewardKind: "xp",
        seasonId: args.seasonId,
        source: "referral_bonus",
        status: "posted",
        userId: refereeId,
        weekStart: args.weekStart,
      });
    }
  }

  return entries;
}

/**
 * Grant every referral rung that has been earned.
 *
 * Runs once per worker pass rather than per account, because a rung depends on
 * one user's activity and pays a different user — there is no account it
 * naturally belongs to. Re-writing rows already granted is free.
 */
export async function grantReferralMilestones(
  config: RewardsConfig,
  args: { seasonId: string; weekStart: string },
): Promise<{ granted: number; milestones: number }> {
  const milestones = await getReferralMilestones(config);
  const entries = buildReferralMilestoneEntries({
    milestones,
    seasonId: args.seasonId,
    weekStart: args.weekStart,
  });

  await upsertRewardLedgerEntries(config, entries);

  return { granted: entries.length, milestones: milestones.length };
}
