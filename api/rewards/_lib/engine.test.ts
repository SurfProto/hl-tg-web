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

  it("completes the first trade quest only after a qualifying funded deposit", () => {
    const fundedSnapshot = buildQuestSnapshot({
      currentTime: "2026-04-14T10:00:00.000Z",
      deposits: [{ amountUsd: 80, occurredAt: "2026-04-01T10:00:00.000Z" }],
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

    const lockedSnapshot = buildQuestSnapshot({
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

    expect(fundedSnapshot.quests.find((quest) => quest.id === "first_trade")?.status).toBe("completed");
    expect(lockedSnapshot.quests.find((quest) => quest.id === "first_trade")?.status).toBe("locked");
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
