import type {
  QuestId,
  QuestProgress,
  QuestStatus,
  VolumeXpGrant,
} from "../../../packages/types/src";

/**
 * One entry in the weekly raffle cohort.
 *
 * Server-internal and dormant: only `_lib/raffle.ts` consumes this, and nothing
 * reachable from a request path does. Deliberately not the API's
 * `LeaderboardEntry` — that one carries no identity by design, and paying a
 * winner needs one. Keeping them separate is what stops a future change to the
 * raffle from quietly reintroducing usernames into a public response.
 */
export interface RaffleCohortEntry {
  userId: string;
  displayName: string;
  rank: number;
  eligibleVolume: number;
  xp: number;
  raffleEligible: boolean;
}

// Keep the server runtime independent from the ESM-only shared types package.
export const APP_TRADE_CLOID_PREFIX = "0x1a17";
export const DEFAULT_FUNDED_DEPOSIT_THRESHOLD_USD = 50;
export const DEFAULT_FIRST_TRADE_THRESHOLD_USD = 10;
export const DEFAULT_XP_PER_USD = 1;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface DepositEvent {
  amountUsd: number;
  occurredAt: string;
}

interface FillEvent {
  fillKey?: string;
  cloid: string | null;
  occurredAt: string;
  price: number;
  size: number;
  /** USDC the exchange charged as a builder fee on this fill. */
  builderFeeUsd?: number;
}

interface BuildQuestSnapshotInput {
  deposits: DepositEvent[];
  fills: FillEvent[];
  hasFundedReferral: boolean;
  /**
   * Whether Telegram says this user is in the app's channel.
   *
   * `null` means the check could not be made — the channel is unconfigured, or
   * the read path, which performs no outbound I/O, is building the snapshot. In
   * that case the quest is omitted entirely rather than shown as incomplete: a
   * quest that cannot be completed is worse than no quest, and a granted one is
   * restored by `grantedQuestIds` regardless.
   */
  hasJoinedTelegramChannel?: boolean | null;
  /**
   * The largest single attributed trade the ledger has recorded this season.
   *
   * The read path performs no exchange I/O, so it has no fills and cannot
   * derive this. Without it the trade quest's bar reads $0 however much the
   * user has traded.
   */
  largestTradeUsd?: number;
  currentTime: string;
  fundedDepositThresholdUsd?: number;
  firstTradeThresholdUsd?: number;
  /**
   * Quests the ledger has already paid, which are completed regardless of what
   * the inputs here suggest.
   *
   * The read path has no fills — ingestion runs on a schedule now, and a
   * dashboard read performs no exchange I/O — so it cannot recompute whether a
   * trade happened. It passes what was granted instead. A paid quest must never
   * appear incomplete just because the evidence was fetched by a different
   * process.
   */
  grantedQuestIds?: QuestId[];
}

interface BuildVolumeXpGrantsInput {
  userId: string;
  seasonId: string | null;
  weekStart: string | null;
  fills: FillEvent[];
  existingFillKeys: Set<string>;
  xpPerUsd?: number;
}

interface LeaderboardInputRow {
  userId: string;
  displayName: string;
  eligibleVolume: number;
  xp: number;
}

interface BuildLeaderboardInput {
  rows: LeaderboardInputRow[];
  currentUserId: string;
  eligibleCohortSize: number;
}

function sortByOccurredAt<T extends { occurredAt: string }>(rows: T[]) {
  return [...rows].sort(
    (left, right) =>
      new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
  );
}

function getFillNotional(fill: FillEvent) {
  return Math.max(0, Math.abs(fill.price) * Math.abs(fill.size));
}

/**
 * Did this fill pay us?
 *
 * It used to test whether the order's `cloid` began with the app's prefix.
 * That was wrong twice over. A client order ID is chosen by whoever places the
 * order, so anyone could mint volume XP by tagging orders they routed
 * elsewhere — and it under-counted badly in the other direction, because
 * orders the app places without carrying that prefix through, notably triggered
 * take-profit and stop-loss orders, earned the user nothing. On the first
 * account checked, 99 of 108 fills had paid a builder fee and only 24 carried
 * the prefix: roughly three quarters of genuinely earned volume was invisible.
 *
 * A builder fee is recorded by the exchange, not by the client. It cannot be
 * set without actually routing through a builder the user has approved, so it
 * cannot be forged for free — the closest attack is routing through a
 * competitor and paying them real money, which is not a rational way to farm.
 *
 * This is the observed tier. Verifying that the fee was paid to *us* rather
 * than to some other builder needs the daily builder-fills export, which names
 * the builder; see the reconciliation notes on rewards_builder_fee_totals.
 */
export function isAppAttributedFill(fill: Pick<FillEvent, "builderFeeUsd">) {
  return (fill.builderFeeUsd ?? 0) > 0;
}

/** Kept for the metadata trail. No longer decides whether a fill earns anything. */
export function hasAppCloid(fill: Pick<FillEvent, "cloid">) {
  return fill.cloid?.toLowerCase().startsWith(APP_TRADE_CLOID_PREFIX) ?? false;
}

function createQuest(args: {
  id: QuestProgress["id"];
  title: string;
  description: string;
  status: QuestStatus;
  completedAt: string | null;
  progressCurrent: number;
  progressTarget: number;
  /** Renders the two numbers when they are dollars rather than a count. */
  progressFormat?: (current: number, target: number) => string;
  rewards: QuestProgress["rewards"];
  granted?: Set<QuestId>;
}): QuestProgress {
  const { granted, progressFormat, ...quest } = args;

  // A granted quest is completed even where the recomputed status disagrees:
  // the ledger row is the record of it having happened, and the inputs the read
  // path has available are a weaker source than the payment itself.
  //
  // The bar has to agree with the badge. Overriding the status alone left a
  // quest rendering as complete above a bar sitting at zero, because the
  // progress numbers still came from inputs the read path cannot see.
  const completed = granted?.has(quest.id) === true || quest.status === "completed";
  const progressCurrent = completed ? quest.progressTarget : quest.progressCurrent;

  return {
    ...quest,
    progressCurrent,
    // Formatted after the override, so a quest completed from the ledger reads
    // "$50 / $50" rather than keeping the caption built from partial inputs.
    ...(progressFormat
      ? { progressLabel: progressFormat(progressCurrent, quest.progressTarget) }
      : {}),
    status: completed ? "completed" : quest.status,
  };
}

export function buildQuestSnapshot(input: BuildQuestSnapshotInput) {
  const granted = new Set(input.grantedQuestIds ?? []);
  const fundedThreshold =
    input.fundedDepositThresholdUsd ?? DEFAULT_FUNDED_DEPOSIT_THRESHOLD_USD;
  const tradeThreshold =
    input.firstTradeThresholdUsd ?? DEFAULT_FIRST_TRADE_THRESHOLD_USD;
  const deposits = sortByOccurredAt(input.deposits);

  /**
   * The deposit that takes the running total to the threshold.
   *
   * Cumulative, not per-transaction. Two thirty-dollar deposits are sixty
   * dollars funded, and the old rule — which tested single deposits against the
   * threshold — saw neither. It also matches how the referral `funded` rung
   * reads the same ledger (migration 020), so the quest a user sees and the
   * rung their referrer is paid for cannot disagree about whether funding
   * happened.
   */
  function crossing(rows: DepositEvent[], target: number) {
    let running = 0;
    for (const row of rows) {
      running += row.amountUsd;
      if (running >= target) {
        return { at: row.occurredAt, total: running };
      }
    }

    return { at: null, total: running };
  }

  const firstCrossing = crossing(deposits, fundedThreshold);
  const firstDeposit = firstCrossing.at
    ? { amountUsd: firstCrossing.total, occurredAt: firstCrossing.at }
    : null;

  // The second threshold is measured from what arrived *after* the first was
  // reached, so the same dollars cannot satisfy both.
  const depositsAfterFunding = firstDeposit
    ? deposits.filter(
        (deposit) =>
          new Date(deposit.occurredAt).getTime() >
            new Date(firstDeposit.occurredAt).getTime() &&
          new Date(deposit.occurredAt).getTime() -
            new Date(firstDeposit.occurredAt).getTime() <=
            SEVEN_DAYS_MS,
      )
    : [];
  const secondCrossing = crossing(depositsAfterFunding, fundedThreshold);
  const secondDepositWithinWindow = secondCrossing.at
    ? { amountUsd: secondCrossing.total, occurredAt: secondCrossing.at }
    : null;
  /**
   * The biggest single trade so far.
   *
   * `first_trade` needs one trade over the threshold, so the nearest miss is
   * the honest measure of progress — not the running total, which would promise
   * a completion that never arrives.
   *
   * Taken from the caller as well as from the fills in hand, because the read
   * path has no fills at all: ingestion is scheduled, so a dashboard request
   * cannot see a single trade and computing this from `input.fills` alone left
   * the bar reading $0 forever, whatever the user had traded. The caller
   * supplies what the ledger already recorded; the fills cover the window being
   * ingested right now, which is not in the ledger yet.
   */
  const largestTradeUsd = Math.max(
    input.largestTradeUsd ?? 0,
    input.fills
      .filter((fill) => isAppAttributedFill(fill))
      .reduce((largest, fill) => Math.max(largest, getFillNotional(fill)), 0),
  );

  /**
   * The first trade over the threshold.
   *
   * No longer gated on the deposit quest. It used to require funding first,
   * which locked it for anyone below the funding bar — and produced the case
   * that exposed it: an account with twenty-two trades over the threshold, and
   * $1,609 of volume, showing the quest as locked because it had deposited $25
   * against a $50 bar.
   *
   * The gate never earned its keep. A fill that paid us a builder fee is proof
   * the account held collateral, which is stronger evidence of funding than the
   * deposit quest's own threshold. Sequencing two quests that describe the same
   * prerequisite only hid one of them.
   */
  const qualifyingTrade =
    sortByOccurredAt(input.fills).find(
      (fill) => isAppAttributedFill(fill) && getFillNotional(fill) >= tradeThreshold,
    ) ??
    (largestTradeUsd >= tradeThreshold ? { occurredAt: null } : null);

  /**
   * Progress against a dollar threshold, for the bar and its caption.
   *
   * A quest whose bar sits at zero until the instant it completes tells the
   * user nothing about how close they are. Reporting the dollars makes the bar
   * proportional — twenty-five of a fifty-dollar deposit reads as half done,
   * because it is.
   */
  function usdProgress(current: number, target: number) {
    return {
      progressCurrent: Math.max(0, Math.min(current, target)),
      progressFormat: (shown: number, of: number) => `${formatUsd(shown)} / ${formatUsd(of)}`,
      progressTarget: target,
    };
  }



  // When membership could not be checked, the channel quest is dropped unless
  // it has already been paid — in which case the ledger, not a live lookup, is
  // what says it happened.
  const showTelegramQuest =
    input.hasJoinedTelegramChannel != null || granted.has("join_telegram_channel");

  const quests: QuestProgress[] = [
    createQuest({
      granted,
      completedAt: firstDeposit?.occurredAt ?? null,
      description: `Fund ${formatUsd(fundedThreshold)} or more for the first time.`,
      id: "first_deposit",
      ...usdProgress(firstCrossing.total, fundedThreshold),
      // XP only, matching what buildQuestRewardEntries actually writes. The
      // USDC line that used to sit here was both a promise the ledger no
      // longer makes and, because the card renders rewards[0], the only
      // reward most users ever saw.
      rewards: [{ amount: 500, kind: "xp", label: "500 XP" }],
      status: firstDeposit ? "completed" : "in_progress",
      title: "First deposit",
    }),
    createQuest({
      granted,
      completedAt: qualifyingTrade?.occurredAt ?? null,
      description: `Place a trade over ${formatUsd(tradeThreshold)}.`,
      id: "first_trade",
      ...usdProgress(largestTradeUsd, tradeThreshold),
      rewards: [{ amount: 300, kind: "xp", label: "300 XP" }],
      status: qualifyingTrade ? "completed" : "in_progress",
      title: "First trade",
    }),
    createQuest({
      granted,
      completedAt: input.hasFundedReferral ? input.currentTime : null,
      description: `Invite one friend who funds at least ${formatUsd(fundedThreshold)}.`,
      id: "referral_funded_friend",
      progressCurrent: input.hasFundedReferral ? 1 : 0,
      progressTarget: 1,
      rewards: [{ amount: 500, kind: "xp", label: "500 XP" }],
      status: input.hasFundedReferral ? "completed" : "in_progress",
      title: "Funded referral",
    }),
    createQuest({
      granted,
      completedAt: input.hasJoinedTelegramChannel ? input.currentTime : null,
      description: "Join the P34K channel on Telegram.",
      id: "join_telegram_channel",
      progressCurrent: input.hasJoinedTelegramChannel ? 1 : 0,
      progressTarget: 1,
      rewards: [{ amount: 200, kind: "xp", label: "200 XP" }],
      status: input.hasJoinedTelegramChannel ? "completed" : "in_progress",
      title: "Join the channel",
    }),
    createQuest({
      granted,
      completedAt: secondDepositWithinWindow?.occurredAt ?? null,
      description: `Deposit ${formatUsd(fundedThreshold)} again within 7 days.`,
      id: "second_deposit_7d",
      ...usdProgress(secondCrossing.total, fundedThreshold),
      rewards: [{ amount: 250, kind: "xp", label: "250 XP" }],
      status: secondDepositWithinWindow
        ? "completed"
        : firstDeposit
          ? "in_progress"
          : "locked",
      title: "Come back in 7 days",
    }),
  ].filter((quest) => quest.id !== "join_telegram_channel" || showTelegramQuest);

  const completedQuestIds = quests
    .filter((quest) => quest.status === "completed")
    .map((quest) => quest.id);

  return {
    completedQuestIds,
    firstQualifyingDepositAt: firstDeposit?.occurredAt ?? null,
    quests,
  };
}

export function buildVolumeXpGrants(
  input: BuildVolumeXpGrantsInput,
): VolumeXpGrant[] {
  const xpPerUsd = input.xpPerUsd ?? DEFAULT_XP_PER_USD;

  return sortByOccurredAt(input.fills)
    .filter((fill) => isAppAttributedFill(fill))
    .filter((fill) => {
      const fillKey = fill.fillKey ?? buildFallbackFillKey(fill);
      return !input.existingFillKeys.has(fillKey);
    })
    .map((fill) => {
      const volumeUsd = getFillNotional(fill);
      return {
        fillKey: fill.fillKey ?? buildFallbackFillKey(fill),
        occurredAt: fill.occurredAt,
        rewardKind: "xp",
        seasonId: input.seasonId,
        userId: input.userId,
        volumeUsd,
        weekStart: input.weekStart,
        xp: Math.floor(volumeUsd * xpPerUsd),
      } satisfies VolumeXpGrant;
    })
    .filter((grant) => grant.xp > 0);
}

/**
 * Rank a weekly raffle cohort in memory.
 *
 * Dormant with the raffle. The public leaderboard is ranked by the database —
 * see rewards_season_leaderboard — because doing it here meant loading every
 * row in the season to return ten.
 */
export function buildTopTraderLeaderboard(input: BuildLeaderboardInput) {
  const entries: RaffleCohortEntry[] = [...input.rows]
    .sort((left, right) => {
      if (right.eligibleVolume !== left.eligibleVolume) {
        return right.eligibleVolume - left.eligibleVolume;
      }

      return left.userId.localeCompare(right.userId);
    })
    .map((row, index) => ({
      displayName: row.displayName,
      eligibleVolume: row.eligibleVolume,
      raffleEligible: index < input.eligibleCohortSize,
      rank: index + 1,
      userId: row.userId,
      xp: row.xp,
    }));

  const currentUser = entries.find((entry) => entry.userId === input.currentUserId) ?? null;
  const cutoffEntry = entries[Math.max(0, input.eligibleCohortSize - 1)] ?? null;
  const cutoffVolume = cutoffEntry?.eligibleVolume ?? 0;
  const userDistanceToCutoff =
    currentUser == null ? cutoffVolume : Math.max(0, cutoffVolume - currentUser.eligibleVolume);

  return {
    cutoffVolume,
    entries,
    userDistanceToCutoff,
    userRank: currentUser?.rank ?? null,
  };
}

function buildFallbackFillKey(fill: FillEvent) {
  return `${fill.occurredAt}:${fill.price}:${fill.size}:${fill.cloid ?? "no-cloid"}`;
}

function formatUsd(amount: number) {
  return `$${amount.toFixed(0)}`;
}
