import { requirePrivySession } from "../onramp/_lib/auth";
import { ensureMethod, HttpError, json, withJsonRoute } from "../onramp/_lib/http";
import { getRewardsConfig } from "./_lib/config";
import {
  getActiveSeason,
  getCheckInStreak,
  getOrCreateRewardsUser,
  getSeasonXpTotals,
  upsertRewardLedgerEntries,
} from "./_lib/supabase-admin";
import { buildTier, tierBonusFor } from "./_lib/tiers";
import { getWeekStartIso } from "./_lib/weeks";

/**
 * Take today's check-in.
 *
 * The one thing in the program that rewards showing up rather than trading,
 * and the largest gap against competitors whose daily grant dwarfs their
 * trading rewards. It is a mutation, so it is an explicit POST rather than a
 * side effect of reading the dashboard — the mistake this program spent a
 * release undoing.
 *
 * Idempotency is the whole design. The key is the UTC date, so a second call
 * on the same day inserts nothing and the append-only writer makes that free.
 * The response is identical either way: a user who taps twice sees the same
 * streak, not an error telling them off for tapping.
 */

/** Flat, and deliberately modest against trading XP. See the streak bonus below. */
const BASE_CHECK_IN_XP = 100;

/** Extra XP per consecutive day, capped, so a long streak is worth protecting. */
const STREAK_STEP_XP = 25;
const STREAK_STEP_CAP = 6;

/**
 * What today's check-in pays, before any tier bonus.
 *
 * The step rewards continuity rather than the act, which is the behaviour worth
 * paying for: the asymmetry between building a streak over a week and losing it
 * in one missed day is what brings somebody back on a day they weren't going to
 * trade.
 */
export function checkInRewardFor(currentStreakDays: number): number {
  const steps = Math.min(currentStreakDays, STREAK_STEP_CAP);
  return BASE_CHECK_IN_XP + steps * STREAK_STEP_XP;
}

/** UTC, matching the streak query. A date that moved with the viewer could be gamed by travelling. */
function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export default async function handler(request: any, response: any) {
  await withJsonRoute(request, response, async () => {
    ensureMethod(request, "POST");

    const config = getRewardsConfig();
    const session = await requirePrivySession(request, config.privyAppId);
    const now = new Date();

    const user = await getOrCreateRewardsUser(config, {
      privyUserId: session.privyUserId,
    });

    const season = await getActiveSeason(config);
    if (!season) {
      throw new HttpError(409, "NO_ACTIVE_SEASON", "There is no season to check in to");
    }

    const [streakBefore, xpBefore] = await Promise.all([
      getCheckInStreak(config, user.id, season.id, now),
      getSeasonXpTotals(config, user.id, season.id),
    ]);

    if (!streakBefore.availableToday) {
      // Not an error. Tapping twice is ordinary, and the honest answer is the
      // same state they already had.
      json(response, 200, {
        success: true,
        data: {
          alreadyCheckedIn: true,
          streak: streakBefore,
          xpGranted: 0,
        },
      });
      return;
    }

    const baseXp = checkInRewardFor(streakBefore.currentDays);
    const tier = buildTier(xpBefore.totalXp);
    const bonusXp = tierBonusFor(baseXp, tier.multiplier);
    const weekStart = getWeekStartIso(now);
    const dateKey = utcDateKey(now);

    // The tier bonus is its own row, not a multiplied amount. Folding it in
    // would make every historical total a function of today's rank, so a
    // promotion would silently rewrite what was earned last week.
    const entries = [
      {
        amount: baseXp,
        asset: null,
        description: `Daily check-in, day ${streakBefore.currentDays + 1}.`,
        idempotencyKey: `daily_check_in:${season.id}:${user.id}:${dateKey}`,
        metadata: { streakDays: streakBefore.currentDays + 1 },
        postedAt: now.toISOString(),
        questId: null,
        rewardKind: "xp" as const,
        seasonId: season.id,
        source: "daily_check_in",
        status: "posted" as const,
        userId: user.id,
        weekStart,
      },
    ];

    if (bonusXp > 0) {
      entries.push({
        amount: bonusXp,
        asset: null,
        description: `${tier.rank} rank bonus on your daily check-in.`,
        idempotencyKey: `tier_bonus:${season.id}:${user.id}:daily_check_in:${dateKey}`,
        metadata: { multiplier: tier.multiplier, rank: tier.rank } as never,
        postedAt: now.toISOString(),
        questId: null,
        rewardKind: "xp" as const,
        seasonId: season.id,
        source: "tier_bonus",
        status: "posted" as const,
        userId: user.id,
        weekStart,
      });
    }

    await upsertRewardLedgerEntries(config, entries);

    const streak = await getCheckInStreak(config, user.id, season.id, now);

    json(response, 200, {
      success: true,
      data: {
        alreadyCheckedIn: false,
        bonusXp,
        streak,
        tier,
        xpGranted: baseXp + bonusXp,
      },
    });
  });
}
