import type {
  LeaderboardEntry,
  QuestProgress,
  QuestStatus,
  VolumeXpGrant,
} from "../../../packages/types/src";
import { APP_TRADE_CLOID_PREFIX } from "../../../packages/types/src";
export { APP_TRADE_CLOID_PREFIX } from "../../../packages/types/src";
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
}

interface BuildQuestSnapshotInput {
  deposits: DepositEvent[];
  fills: FillEvent[];
  hasFundedReferral: boolean;
  currentTime: string;
  fundedDepositThresholdUsd?: number;
  firstTradeThresholdUsd?: number;
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

export function isAppAttributedFill(fill: Pick<FillEvent, "cloid">) {
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
  rewards: QuestProgress["rewards"];
}): QuestProgress {
  return args;
}

export function buildQuestSnapshot(input: BuildQuestSnapshotInput) {
  const fundedThreshold =
    input.fundedDepositThresholdUsd ?? DEFAULT_FUNDED_DEPOSIT_THRESHOLD_USD;
  const tradeThreshold =
    input.firstTradeThresholdUsd ?? DEFAULT_FIRST_TRADE_THRESHOLD_USD;
  const qualifyingDeposits = sortByOccurredAt(input.deposits).filter(
    (deposit) => deposit.amountUsd >= fundedThreshold,
  );
  const firstDeposit = qualifyingDeposits[0] ?? null;
  const secondDepositWithinWindow =
    firstDeposit == null
      ? null
      : qualifyingDeposits.find((deposit, index) => {
          if (index === 0) {
            return false;
          }
          const delta =
            new Date(deposit.occurredAt).getTime() -
            new Date(firstDeposit.occurredAt).getTime();
          return delta >= 0 && delta <= SEVEN_DAYS_MS;
        }) ?? null;
  const qualifyingTrade =
    firstDeposit == null
      ? null
      : sortByOccurredAt(input.fills).find((fill) => {
          if (!isAppAttributedFill(fill)) {
            return false;
          }

          if (new Date(fill.occurredAt).getTime() < new Date(firstDeposit.occurredAt).getTime()) {
            return false;
          }

          return getFillNotional(fill) >= tradeThreshold;
        }) ?? null;

  const quests: QuestProgress[] = [
    createQuest({
      completedAt: firstDeposit?.occurredAt ?? null,
      description: `Fund ${formatUsd(fundedThreshold)} or more for the first time.`,
      id: "first_deposit",
      progressCurrent: Math.min(qualifyingDeposits.length, 1),
      progressTarget: 1,
      rewards: [
        { amount: 5, kind: "usdc", label: "5 USDC" },
        { amount: 500, kind: "xp", label: "500 XP" },
      ],
      status: firstDeposit ? "completed" : "in_progress",
      title: "First deposit",
    }),
    createQuest({
      completedAt: qualifyingTrade?.occurredAt ?? null,
      description: `Place your first app trade over ${formatUsd(tradeThreshold)} after funding.`,
      id: "first_trade",
      progressCurrent: qualifyingTrade ? 1 : 0,
      progressTarget: 1,
      rewards: [
        { amount: 3, kind: "usdc", label: "3 USDC" },
        { amount: 300, kind: "xp", label: "300 XP" },
      ],
      status: qualifyingTrade
        ? "completed"
        : firstDeposit
          ? "in_progress"
          : "locked",
      title: "First trade",
    }),
    createQuest({
      completedAt: input.hasFundedReferral ? input.currentTime : null,
      description: `Invite one friend who funds at least ${formatUsd(fundedThreshold)}.`,
      id: "referral_funded_friend",
      progressCurrent: input.hasFundedReferral ? 1 : 0,
      progressTarget: 1,
      rewards: [
        { amount: 5, kind: "usdc", label: "5 USDC" },
        { amount: 500, kind: "xp", label: "500 XP" },
      ],
      status: input.hasFundedReferral ? "completed" : "in_progress",
      title: "Funded referral",
    }),
    createQuest({
      completedAt: secondDepositWithinWindow?.occurredAt ?? null,
      description: `Deposit ${formatUsd(fundedThreshold)} again within 7 days.`,
      id: "second_deposit_7d",
      progressCurrent: Math.min(qualifyingDeposits.length, 2),
      progressTarget: 2,
      rewards: [{ amount: 250, kind: "xp", label: "250 XP" }],
      status: secondDepositWithinWindow
        ? "completed"
        : firstDeposit
          ? "in_progress"
          : "locked",
      title: "Come back in 7 days",
    }),
  ];

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

export function buildTopTraderLeaderboard(input: BuildLeaderboardInput) {
  const entries: LeaderboardEntry[] = [...input.rows]
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
