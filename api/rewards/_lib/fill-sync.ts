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
import { getWeekStartIso } from "./weeks";
import {
  completeFillSync,
  getFundedReferralStats,
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

export type FillSyncErrorCode = "EXCHANGE_UNAVAILABLE" | "LEDGER_WRITE_FAILED";

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
  now?: () => number;
  /** The season's start, for the deposit and referral reads quests depend on. */
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
  // Bounded so one neglected account cannot consume the whole run, and never
  // past now: a window into the future would advance the cursor over fills that
  // have not happened yet, and those fills would then never be read.
  const endMs = Math.min(now, startMs + MAX_WINDOW_MS);
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
  let allEntries: RewardLedgerInsertInput[] = entries;
  try {
    allEntries = [
      ...entries,
      ...(await buildQuestAndReferralEntries(config, claim, {
        fills: appFills,
        seasonStartsAt: deps.seasonStartsAt,
      })),
    ];
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
    cursorTime: new Date(nextCursorMs(window)).toISOString(),
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
export async function buildQuestAndReferralEntries(
  config: RewardsConfig,
  claim: FillSyncClaim,
  args: { fills: FillSummary[]; seasonStartsAt: string },
): Promise<RewardLedgerInsertInput[]> {
  const weekStart = getWeekStartIso(new Date());
  const [deposits, referralStats, user] = await Promise.all([
    getQualifyingDeposits(config, claim.userId, args.seasonStartsAt),
    getFundedReferralStats(
      config,
      claim.userId,
      args.seasonStartsAt,
      config.fundedDepositThresholdUsd,
    ),
    getUserById(config, claim.userId),
  ]);

  const snapshot = buildQuestSnapshot({
    currentTime: new Date().toISOString(),
    deposits,
    fills: args.fills,
    firstTradeThresholdUsd: config.firstTradeThresholdUsd,
    fundedDepositThresholdUsd: config.fundedDepositThresholdUsd,
    hasFundedReferral: referralStats.fundedReferralCount > 0,
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
