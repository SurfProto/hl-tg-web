import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_TRADE_CLOID_PREFIX,
  buildQuestSnapshot,
  buildTopTraderLeaderboard,
  buildVolumeXpGrants,
} from "./engine";

describe("buildQuestSnapshot", () => {
  it("completes the funded deposit and second deposit within 7 days quests", () => {
    const snapshot = buildQuestSnapshot({
      currentTime: "2026-04-14T10:00:00.000Z",
      deposits: [
        { amountUsd: 75, occurredAt: "2026-04-01T10:00:00.000Z" },
        { amountUsd: 65, occurredAt: "2026-04-05T10:00:00.000Z" },
      ],
      fills: [],
      hasFundedReferral: false,
    });

    expect(snapshot.quests.find((quest) => quest.id === "first_deposit")?.status).toBe("completed");
    expect(snapshot.quests.find((quest) => quest.id === "second_deposit_7d")?.status).toBe("completed");
  });

  /**
   * The funding gate is gone. It used to lock this quest for anyone below the
   * funding bar — an account with twenty-two qualifying trades showed it as
   * locked over a $25 deposit against a $50 bar. A fill that paid a builder
   * fee is stronger evidence of funding than the deposit quest's threshold.
   */
  it("completes the first trade quest on a qualifying trade, deposits or not", () => {
    const snapshot = buildQuestSnapshot({
      currentTime: "2026-04-14T10:00:00.000Z",
      deposits: [],
      fills: [
        {
          builderFeeUsd: 0.01,
          cloid: `${APP_TRADE_CLOID_PREFIX}aa01`,
          occurredAt: "2026-04-02T10:00:00.000Z",
          price: 2,
          size: 20,
        },
      ],
      hasFundedReferral: false,
    });

    const quest = snapshot.quests.find((entry) => entry.id === "first_trade")!;
    expect(quest.status).toBe("completed");
    expect(quest.completedAt).toBe("2026-04-02T10:00:00.000Z");
  });

  /**
   * The read path performs no exchange I/O, so a dashboard request has no
   * fills — the caller passes what the ledger already recorded. Without that
   * input the bar read $0 however much the user had traded.
   */
  it("completes the trade quest from the ledger's largest trade when fills are absent", () => {
    const snapshot = buildQuestSnapshot({
      currentTime: "2026-04-14T10:00:00.000Z",
      deposits: [],
      fills: [],
      hasFundedReferral: false,
      largestTradeUsd: 40,
    });

    const quest = snapshot.quests.find((entry) => entry.id === "first_trade")!;
    expect(quest.status).toBe("completed");
    // The bar has to agree with the badge.
    expect(quest.progressCurrent).toBe(quest.progressTarget);
    expect(quest.progressLabel).toBe("$10 / $10");
  });

  it("completes the funded referral quest when a referred friend funds", () => {
    const snapshot = buildQuestSnapshot({
      currentTime: "2026-04-14T10:00:00.000Z",
      deposits: [],
      fills: [],
      hasFundedReferral: true,
    });

    expect(snapshot.quests.find((quest) => quest.id === "referral_funded_friend")?.status).toBe("completed");
  });

  const base = {
    currentTime: "2026-04-14T10:00:00.000Z",
    deposits: [],
    fills: [],
    hasFundedReferral: false,
  };

  /**
   * A bar that sits at zero until the instant it completes tells the user
   * nothing about how close they are. Half the money is half the quest.
   */
  it("reports a part-funded deposit quest in dollars, not as zero of one", () => {
    const snapshot = buildQuestSnapshot({
      ...base,
      deposits: [
        { amountUsd: 15, occurredAt: "2026-04-01T10:00:00.000Z" },
        { amountUsd: 10, occurredAt: "2026-04-02T10:00:00.000Z" },
      ],
    });

    const quest = snapshot.quests.find((entry) => entry.id === "first_deposit")!;
    expect(quest.status).toBe("in_progress");
    expect(quest.progressCurrent).toBe(25);
    expect(quest.progressTarget).toBe(50);
    expect(quest.progressLabel).toBe("$25 / $50");
  });

  /**
   * Cumulative, matching the referral `funded` rung against the same ledger, so
   * the quest a user sees and the rung their referrer is paid for cannot
   * disagree. The old rule tested single deposits and saw neither of these.
   */
  it("completes the deposit quest on deposits that only add up together", () => {
    const snapshot = buildQuestSnapshot({
      ...base,
      deposits: [
        { amountUsd: 30, occurredAt: "2026-04-01T10:00:00.000Z" },
        { amountUsd: 30, occurredAt: "2026-04-02T10:00:00.000Z" },
      ],
    });

    const quest = snapshot.quests.find((entry) => entry.id === "first_deposit")!;
    expect(quest.status).toBe("completed");
    // Dated from the deposit that crossed the bar, not the first one.
    expect(quest.completedAt).toBe("2026-04-02T10:00:00.000Z");
    expect(quest.progressLabel).toBe("$50 / $50");
  });

  // The same dollars must not satisfy both thresholds.
  it("measures the seven-day quest only on what arrived after funding", () => {
    const snapshot = buildQuestSnapshot({
      ...base,
      deposits: [
        { amountUsd: 60, occurredAt: "2026-04-01T10:00:00.000Z" },
        { amountUsd: 20, occurredAt: "2026-04-03T10:00:00.000Z" },
      ],
    });

    const quest = snapshot.quests.find((entry) => entry.id === "second_deposit_7d")!;
    expect(quest.status).toBe("in_progress");
    expect(quest.progressCurrent).toBe(20);
  });

  /**
   * `first_trade` needs one trade over the threshold, so the nearest miss is
   * the honest measure — a running total would promise a completion that never
   * arrives.
   */
  it("measures the trade quest on the largest single trade so far", () => {
    const snapshot = buildQuestSnapshot({
      ...base,
      deposits: [{ amountUsd: 80, occurredAt: "2026-04-01T10:00:00.000Z" }],
      fills: [
        { builderFeeUsd: 0.01, cloid: null, occurredAt: "2026-04-02T10:00:00.000Z", price: 2, size: 1 },
        { builderFeeUsd: 0.01, cloid: null, occurredAt: "2026-04-03T10:00:00.000Z", price: 4, size: 1 },
      ],
    });

    const quest = snapshot.quests.find((entry) => entry.id === "first_trade")!;
    expect(quest.status).toBe("in_progress");
    // The $4 trade, not the $6 the two of them add up to.
    expect(quest.progressCurrent).toBe(4);
    expect(quest.progressLabel).toBe("$4 / $10");
  });

  function telegramQuest(snapshot: ReturnType<typeof buildQuestSnapshot>) {
    return snapshot.quests.find((quest) => quest.id === "join_telegram_channel");
  }

  it("completes the channel quest when Telegram says the user is in it", () => {
    const snapshot = buildQuestSnapshot({ ...base, hasJoinedTelegramChannel: true });

    expect(telegramQuest(snapshot)?.status).toBe("completed");
    expect(snapshot.completedQuestIds).toContain("join_telegram_channel");
  });

  it("offers the channel quest as unfinished when the user is not in it", () => {
    const snapshot = buildQuestSnapshot({ ...base, hasJoinedTelegramChannel: false });

    expect(telegramQuest(snapshot)?.status).toBe("in_progress");
    expect(snapshot.completedQuestIds).not.toContain("join_telegram_channel");
  });

  /**
   * Showing a quest nobody can complete is worse than showing no quest. The
   * read path performs no outbound I/O and an unconfigured channel cannot be
   * checked, so both pass null.
   */
  it("hides the channel quest when membership cannot be checked", () => {
    const snapshot = buildQuestSnapshot({ ...base, hasJoinedTelegramChannel: null });

    expect(telegramQuest(snapshot)).toBeUndefined();
  });

  // Except once it has been paid: then the ledger, not a live lookup, is what
  // says it happened, and the user must keep seeing it as done.
  it("still shows a paid channel quest when membership cannot be checked", () => {
    const snapshot = buildQuestSnapshot({
      ...base,
      grantedQuestIds: ["join_telegram_channel"],
      hasJoinedTelegramChannel: null,
    });

    expect(telegramQuest(snapshot)?.status).toBe("completed");
  });
});

describe("buildVolumeXpGrants", () => {
  it("grants xp only for app-attributed fills and deduplicates by fill key", () => {
    const grants = buildVolumeXpGrants({
      userId: "user-1",
      seasonId: "season-1",
      weekStart: "2026-04-14T00:00:00.000Z",
      xpPerUsd: 1,
      existingFillKeys: new Set(["fill-1"]),
      fills: [
        {
          fillKey: "fill-1",
          builderFeeUsd: 0.01,
          cloid: `${APP_TRADE_CLOID_PREFIX}1111`,
          occurredAt: "2026-04-14T08:00:00.000Z",
          price: 2,
          size: 20,
        },
        {
          fillKey: "fill-2",
          builderFeeUsd: 0.01,
          cloid: `${APP_TRADE_CLOID_PREFIX}2222`,
          occurredAt: "2026-04-14T09:00:00.000Z",
          price: 3,
          size: 10,
        },
        {
          fillKey: "fill-3",
          builderFeeUsd: 0,
          cloid: null,
          occurredAt: "2026-04-14T09:30:00.000Z",
          price: 9,
          size: 10,
        },
      ],
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      fillKey: "fill-2",
      volumeUsd: 30,
      xp: 30,
      rewardKind: "xp",
    });
  });
});

describe("buildTopTraderLeaderboard", () => {
  it("sorts by eligible volume and marks only the top cohort as raffle eligible", () => {
    const leaderboard = buildTopTraderLeaderboard({
      currentUserId: "user-2",
      eligibleCohortSize: 2,
      rows: [
        { displayName: "Bravo", eligibleVolume: 200, userId: "user-2", xp: 250 },
        { displayName: "Alpha", eligibleVolume: 350, userId: "user-1", xp: 400 },
        { displayName: "Charlie", eligibleVolume: 150, userId: "user-3", xp: 175 },
      ],
    });

    expect(leaderboard.entries.map((entry) => entry.userId)).toEqual(["user-1", "user-2", "user-3"]);
    expect(leaderboard.entries.map((entry) => entry.raffleEligible)).toEqual([true, true, false]);
    expect(leaderboard.userRank).toBe(2);
    expect(leaderboard.cutoffVolume).toBe(200);
    expect(leaderboard.userDistanceToCutoff).toBe(0);
  });
});

describe("engine module packaging", () => {
  it("does not use a runtime value import from packages/types", () => {
    const sourcePath = resolve(import.meta.dirname, "engine.ts");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain(
      'import { APP_TRADE_CLOID_PREFIX } from "../../../packages/types/src";',
    );
    expect(source).not.toContain(
      'export { APP_TRADE_CLOID_PREFIX } from "../../../packages/types/src";',
    );
  });
});
