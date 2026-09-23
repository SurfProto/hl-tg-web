import type { QuestId } from "../../../packages/types/src";
import type { RewardsConfig } from "./config";
import { buildQuestSnapshot, buildVolumeXpGrants, isAppAttributedFill } from "./engine";
import {
  FILL_HISTORY_LIMIT,
  fetchFillsInWindow,
  nextCursorMs,
  type FillSummary,
  type FillWindow,
  type RawFill,
} from "./fill-windows";
import { getChannelMembership } from "./telegram-membership";
import { getWeekStartIso } from "./weeks";
import {
  completeFillSync,
  getFundedReferralStats,
  getGrantedQuestIds,
  getLargestTradeUsd,
  getQualifyingDeposits,
  getUserById,
  upsertRewardLedgerEntries,
  type FillSyncClaim,
  type RewardLedgerInsertInput,
} from "./supabase-admin";

/**
 * Ingest one account's fills and grant the XP they earned.
 *
 * The unit of work is one (user, season, wallet) checkpoint. Everything here is
 * replay-safe: the ledger's idempotency key makes a repeated window a no-op,
 * and the cursor only advances after the ledger write returns. A crash between
 * the two therefore costs a re-read, never a lost grant or a double grant --
 * which is the whole reason the cursor is not advanced first.
 */

/** Stops one very stale account from monopolising a run. */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type FillSyncErrorCode =
  | "EXCHANGE_UNAVAILABLE"
  | "LEDGER_WRITE_FAILED"
  | "SEASON_BOUNDS_INVALID";

export interface FillSyncResult {
  checkpointId: string;
  errorCode: FillSyncErrorCode | null;
  fillsIngested: number;
  grantsWritten: number;
  requestCount: number;
  retentionRisk: boolean;
  windowEndMs: number;
  windowStartMs: number;
}

export interface SyncAccountFillsDeps {
  /** Injected so the worker can be driven without an exchange in tests. */
  fetchFills: (walletAddress: string, window: FillWindow) => Promise<RawFill[]>;
  /**
   * Whether this claim belongs to the season running now. Quests are
   * evaluated only for that one; see buildQuestAndReferralEntries' caller.
   */
  isCurrentSeason: boolean;
  now?: () => number;
  /**
   * The end of the *claim's* season — not the current one. Seasons are
   * half-open, so this is the first instant of the next season and no fill at
   * or after it belongs to this checkpoint.
   */
  seasonEndsAt: string;
  /** The current season's start, for the deposit reads quests depend on. */
  seasonStartsAt: string;
}

function toGrantEntries(args: {
  fills: FillSummary[];
  existingFillKeys: Set<string>;
  seasonId: string;
  userId: string;
  xpPerUsd: number;
}): RewardLedgerInsertInput[] {
  const grants = buildVolumeXpGrants({
    existingFillKeys: args.existingFillKeys,
    fills: args.fills,
    seasonId: args.seasonId,
    userId: args.userId,
    weekStart: getWeekStartIso(new Date()),
    xpPerUsd: args.xpPerUsd,
  });

  // Indexed so the builder fee behind each grant can be looked up without
  // re-deriving it from the exchange. That is what lets the ledger be
  // reconciled against the builder-fee total Hyperliquid reports for us.
  const feeByFillKey = new Map(args.fills.map((fill) => [fill.fillKey, fill.builderFeeUsd]));

  return grants.map((grant) => ({
    amount: grant.xp,
    asset: null,
    description: `Trading volume XP for ${grant.volumeUsd.toFixed(2)} USD of app volume.`,
    idempotencyKey: `volume_xp:${args.seasonId}:${args.userId}:${grant.fillKey}`,
    metadata: {
      builderFeeUsd: feeByFillKey.get(grant.fillKey) ?? 0,
      fillKey: grant.fillKey,
      // When the fill happened, not when the grant was written. Reconciling
      // against the daily builder-fills export needs to put each grant on the
      // day the exchange filed it under, and a grant written by a backfill can
      // be days later than the trade it pays for.
      occurredAt: grant.occurredAt,
      volumeUsd: grant.volumeUsd,
    },
    postedAt: new Date().toISOString(),
    questId: null,
    rewardKind: "xp" as const,
    seasonId: args.seasonId,
    source: "volume_xp",
    status: "posted" as const,
    userId: args.userId,
    // The week the fill happened in, not the week it was ingested. A backfill
    // running on Tuesday must not file last Friday's trade under this week.
    weekStart: getWeekStartIso(new Date(grant.occurredAt)),
  }));
}

export async function syncAccountFills(
  config: RewardsConfig,
  claim: FillSyncClaim,
  deps: SyncAccountFillsDeps,
): Promise<FillSyncResult> {
  const now = deps.now?.() ?? Date.now();
  const startMs = new Date(claim.cursorTime).getTime();
  const seasonEndsAtMs = new Date(deps.seasonEndsAt).getTime();

  // Fail closed on a season end that does not parse. NaN does not bound
  // anything — Math.min returns it, the early return below does not fire, and
  // the exchange is asked for [cursor, now]: the exact unbounded read this
  // bound exists to remove, followed by a throw from toISOString after the
  // ledger write had already landed. Recorded against the checkpoint, so a
  // season row that ever stops parsing shows up as failing rather than as a
  // quiet double grant.
  if (!Number.isFinite(seasonEndsAtMs)) {
    await completeFillSync(config, {
      checkpointId: claim.checkpointId,
      errorCode: "SEASON_BOUNDS_INVALID",
    });
    return {
      checkpointId: claim.checkpointId,
      errorCode: "SEASON_BOUNDS_INVALID",
      fillsIngested: 0,
      grantsWritten: 0,
      requestCount: 0,
      retentionRisk: false,
      windowEndMs: startMs,
      windowStartMs: startMs,
    };
  }
  // Windows are inclusive at both ends and seasons are half-open, so the last
  // instant this checkpoint may read is one millisecond before its season
  // ends. A fill at exactly ends_at is the next season's.
  const lastSeasonMs = seasonEndsAtMs - 1;
  // Bounded so one neglected account cannot consume the whole run, never past
  // now — a window into the future would advance the cursor over fills that
  // have not happened yet, and those fills would then never be read — and
  // never past the end of the claim's own season.
  //
  // That last bound is the fix for the season-rollover double grant. It was
  // missing, so on 2026-09-01 every August checkpoint kept reading
  // [cursor, now] into September beside the September checkpoint for the same
  // wallet, and each fill was granted once under each season: the key embeds
  // the season, so the two rows never collided.
  //
  // This bound is the one that stops new duplicates on its own. Migration
  // 030's claim filter also retires a checkpoint whose season is done, but
  // only after its cursor reaches ends_at — so without this bound, one window
  // per straddling checkpoint still crosses the next rollover before it
  // retires. This code must therefore be live before a rollover; the
  // migration is what stops already-stranded checkpoints being claimed.
  const endMs = Math.min(now, startMs + MAX_WINDOW_MS, lastSeasonMs);
  const reachesSeasonEnd = endMs >= lastSeasonMs;
  const window: FillWindow = { endMs, startMs };

  const base = {
    checkpointId: claim.checkpointId,
    fillsIngested: 0,
    grantsWritten: 0,
    requestCount: 0,
    retentionRisk: false,
    windowEndMs: endMs,
    windowStartMs: startMs,
  };

  // Nothing left to read. Either the cursor is ahead of now, or — the case the
  // season bound adds — it is already at or past the end of its own season,
  // which is where every August checkpoint stood by the time this was fixed.
  // Returning before any fetch is what stops a stale checkpoint granting
  // anything at all, even from a claim RPC that still offers it.
  if (startMs > endMs) {
    return { ...base, errorCode: null };
  }

  let fetched;
  try {
    fetched = await fetchFillsInWindow(
      (nextWindow) => deps.fetchFills(claim.walletAddress, nextWindow),
      window,
    );
  } catch {
    // The upstream message is deliberately discarded rather than stored: this
    // value reaches a reconciliation surface, and an exchange error body is not
    // something to persist and re-display.
    await completeFillSync(config, {
      checkpointId: claim.checkpointId,
      errorCode: "EXCHANGE_UNAVAILABLE",
    });
    return { ...base, errorCode: "EXCHANGE_UNAVAILABLE" };
  }

  const appFills = fetched.fills.filter((fill) => isAppAttributedFill(fill));

  // Past the exchange's history ceiling the API can no longer answer for the
  // whole season however the windows are cut, so completeness stops being
  // provable even though everything ingested is correct.
  const retentionRisk =
    fetched.retentionRisk || claim.fillsIngested + fetched.fills.length >= FILL_HISTORY_LIMIT;

  // No pre-read of already-granted keys. Since the ledger write is
  // insert-on-conflict-do-nothing keyed by fill, regenerating a grant that
  // already exists costs one ignored row — cheaper and more obviously correct
  // than a round trip to compute a set whose only job is to avoid it.
  const entries = toGrantEntries({
    existingFillKeys: new Set(),
    fills: appFills,
    seasonId: claim.seasonId,
    userId: claim.userId,
    xpPerUsd: config.xpPerUsd,
  });

  // Quest and referral XP ride along in the same batch: one write, one failure
  // mode, and no window where the volume grants landed but the quest they
  // completed did not.
  //
  // Only for the season running now. A checkpoint finishing the tail of a
  // closed season grants the volume it reads and nothing else, because every
  // input a quest reads apart from these fills belongs to the present: the
  // deposit read starts at the *current* season's start, and channel
  // membership has no date at all. That mismatch is what paid first_deposit
  // and first_trade under August for activity in September. The cost of the
  // rule is narrow and deliberate — a quest completed by a trade in a
  // season's final minutes, and not ingested until after rollover, is not
  // granted for the closed season — and an undercount at one edge is the
  // right trade against a systematic double count.
  //
  // "Running now" is checked against this claim's season end as well as the
  // flag the worker passes, because the flag is computed once, at the start
  // of a run, and a run can straddle midnight. Checked here, per claim, the
  // rule becomes an invariant: no quest is ever written after its season has
  // ended. Migration 030's repair reads "a quest written after its season
  // ended" as "a quest the pre-fix worker wrote", and this is what keeps that
  // true — and what makes it safe to re-run after a future rollover.
  const questsAllowed = deps.isCurrentSeason && now < seasonEndsAtMs;
  let allEntries: RewardLedgerInsertInput[] = entries;
  try {
    allEntries = questsAllowed
      ? [
          ...entries,
          ...(await buildQuestAndReferralEntries(config, claim, {
            fills: appFills,
            seasonStartsAt: deps.seasonStartsAt,
          })),
        ]
      : entries;
  } catch {
    await completeFillSync(config, {
      checkpointId: claim.checkpointId,
      errorCode: "LEDGER_WRITE_FAILED",
      retentionRisk,
    });
    return {
      ...base,
      errorCode: "LEDGER_WRITE_FAILED",
      requestCount: fetched.requestCount,
      retentionRisk,
    };
  }

  try {
    // Writes first, cursor second. The ledger is append-only and keyed by fill,
    // so re-writing a window is free; skipping one is not.
    await upsertRewardLedgerEntries(config, allEntries);
  } catch {
    await completeFillSync(config, {
      checkpointId: claim.checkpointId,
      errorCode: "LEDGER_WRITE_FAILED",
      retentionRisk,
    });
    return { ...base, errorCode: "LEDGER_WRITE_FAILED", requestCount: fetched.requestCount, retentionRisk };
  }

  await completeFillSync(config, {
    checkpointId: claim.checkpointId,
    // A window that reached the season's last millisecond has proven the whole
    // season ingested, so the cursor goes to the season boundary itself rather
    // than one millisecond short of it. ends_at is exactly the value migration
    // 030's claim treats as done (`cursor_time < ends_at`), so the checkpoint
    // retires here instead of being re-offered forever on a zero-width window.
    // Safe to claim that instant: it belongs to the next season, which this
    // checkpoint never reads.
    cursorTime: new Date(
      reachesSeasonEnd ? seasonEndsAtMs : nextCursorMs(window),
    ).toISOString(),
    fillsIngested: fetched.fills.length,
    retentionRisk,
  });

  return {
    ...base,
    errorCode: null,
    fillsIngested: fetched.fills.length,
    grantsWritten: allEntries.length,
    requestCount: fetched.requestCount,
    retentionRisk,
  };
}

/**
 * Quest and referral XP, written by the worker rather than by a page view.
 *
 * These used to be emitted from the dashboard read, which meant a user only
 * earned a quest by looking at the screen that told them about it. They live
 * here now for the same reason volume XP does: what somebody earned should not
 * depend on whether they visited.
 *
 * Idempotency keys keep their `:xp` suffix so rows already granted stay matched
 * rather than being re-granted under a new key.
 */
export function buildQuestRewardEntries(args: {
  questIds: QuestId[];
  seasonId: string;
  userId: string;
  weekStart: string;
}): RewardLedgerInsertInput[] {
  const definitions: Record<QuestId, { description: string; xp: number }> = {
    first_deposit: { description: "Completed your first qualifying deposit.", xp: 500 },
    first_trade: { description: "Completed your first qualifying trade.", xp: 300 },
    join_telegram_channel: {
      description: "Joined the P34K channel on Telegram.",
      xp: 200,
    },
    referral_funded_friend: {
      description: "A referred friend completed a funded deposit.",
      xp: 500,
    },
    second_deposit_7d: {
      description: "Completed a second qualifying deposit within 7 days.",
      xp: 250,
    },
  };

  return args.questIds.map((questId) => ({
    amount: definitions[questId].xp,
    asset: null,
    description: definitions[questId].description,
    idempotencyKey: `quest:${args.seasonId}:${args.userId}:${questId}:xp`,
    metadata: null,
    postedAt: new Date().toISOString(),
    questId,
    rewardKind: "xp" as const,
    seasonId: args.seasonId,
    source: "quest",
    status: "posted" as const,
    userId: args.userId,
    weekStart: args.weekStart,
  }));
}

/** XP only, for the same reason as the quest entries above. */
export function buildReferralBonusEntries(args: {
  seasonId: string;
  userId: string;
  weekStart: string;
}): RewardLedgerInsertInput[] {
  return [
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

/**
 * Quest and referral entries earned by one account, given the fills just read.
 *
 * Returned rather than written so the caller can commit them in the same
 * append-only batch as the volume grants — one write, one failure mode.
 */
/**
 * Whether this user is in the Telegram channel, or null if we cannot say.
 *
 * Asked of Telegram only while the quest is unpaid. Once the grant exists the
 * answer cannot change anything — the ledger is append-only — so continuing to
 * ask would be one outbound request per account per run, forever, against a bot
 * API with a global rate limit.
 *
 * An unavailable answer is logged rather than folded into "not a member". A
 * channel id that is wrong, or a bot that is not an administrator of it, would
 * otherwise look exactly like nobody having joined, and the quest would sit at
 * zero indefinitely with nothing reporting a fault — which is precisely how the
 * fill notifications managed to be silent for four months.
 */
async function resolveChannelMembership(
  config: RewardsConfig,
  args: { grantedQuestIds: QuestId[]; telegramId: string | null; userId: string },
): Promise<boolean | null> {
  if (args.grantedQuestIds.includes("join_telegram_channel")) {
    return true;
  }

  if (!config.telegramBotToken || !config.telegramChannelId || !args.telegramId) {
    return null;
  }

  const membership = await getChannelMembership({
    botToken: config.telegramBotToken,
    channelId: config.telegramChannelId,
    telegramUserId: args.telegramId,
  });

  if (membership.kind === "unavailable") {
    console.warn(
      `[rewards-sync] channel membership unavailable user=${args.userId} code=${membership.code}`,
    );
    return null;
  }

  return membership.kind === "member";
}

export async function buildQuestAndReferralEntries(
  config: RewardsConfig,
  claim: FillSyncClaim,
  args: { fills: FillSummary[]; seasonStartsAt: string },
): Promise<RewardLedgerInsertInput[]> {
  const weekStart = getWeekStartIso(new Date());
  const [deposits, referralStats, user, grantedQuestIds, largestTradeUsd] = await Promise.all([
    getQualifyingDeposits(config, claim.userId, args.seasonStartsAt),
    getFundedReferralStats(
      config,
      claim.userId,
      args.seasonStartsAt,
      config.fundedDepositThresholdUsd,
    ),
    getUserById(config, claim.userId),
    getGrantedQuestIds(config, claim.userId, claim.seasonId),
    getLargestTradeUsd(config, claim.userId, claim.seasonId),
  ]);

  const snapshot = buildQuestSnapshot({
    currentTime: new Date().toISOString(),
    deposits,
    fills: args.fills,
    firstTradeThresholdUsd: config.firstTradeThresholdUsd,
    fundedDepositThresholdUsd: config.fundedDepositThresholdUsd,
    grantedQuestIds,
    hasFundedReferral: referralStats.fundedReferralCount > 0,
    // The ledger's best so far, plus the window being ingested right now —
    // which is not in the ledger yet, because these entries are what will put
    // it there.
    largestTradeUsd,
    hasJoinedTelegramChannel: await resolveChannelMembership(config, {
      grantedQuestIds,
      telegramId: user?.telegram_id ?? null,
      userId: claim.userId,
    }),
  });

  // referral_funded_friend is excluded deliberately. Its grant key was
  // quest:{season}:{referrer}:referral_funded_friend:xp — one row per referrer
  // per season — so a referrer who brought ten funded friends was paid for one.
  // Referral XP now comes solely from the milestone ladder, which keys on the
  // referee. The quest stays in the snapshot as a display of progress.
  return buildQuestRewardEntries({
    questIds: snapshot.completedQuestIds.filter(
      (questId) => questId !== "referral_funded_friend",
    ),
    seasonId: claim.seasonId,
    userId: claim.userId,
    weekStart,
  });
}
