import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * runWeeklyRaffle checked for existing winners, drew, then upserted. Two
 * concurrent firings both saw no winners and both drew; the per-user ledger
 * idempotency key then merged the two draws, producing more winners than
 * weeklyWinnerCount with prizes assigned by index in whichever draw they
 * landed in. A claim on (season, week) has to come first.
 */

const mocks = vi.hoisted(() => ({
  getOrCreateActiveSeason: vi.fn(),
  getRewardLedgerEntriesBySource: vi.fn(),
  claimWeeklyRaffleRun: vi.fn(),
  completeWeeklyRaffleRun: vi.fn(),
  getWeeklyVolumeRows: vi.fn(),
  getUsersByIds: vi.fn(),
  patchWeeklyReward: vi.fn(),
  upsertRewardLedgerEntries: vi.fn(),
}));

vi.mock("./supabase-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./supabase-admin")>()),
  ...mocks,
}));

// The draw moved to ./raffle when the program went XP-only: keeping it out of
// program.ts is what lets the dashboard's module graph be payout-free. The
// serialisation this file covers is unchanged, so the test moved with it.
import { runWeeklyRaffle } from "./raffle";

function config(overrides: Record<string, unknown> = {}) {
  return {
    rafflePrizeAmounts: [50, 25, 10],
    weeklyWinnerCount: 3,
    weeklyTopTraderCohortSize: 10,
    treasuryPrivateKey: null,
    ...overrides,
  } as any;
}

describe("runWeeklyRaffle claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreateActiveSeason.mockResolvedValue({ id: "season-1" });
    mocks.getRewardLedgerEntriesBySource.mockResolvedValue([]);
    mocks.claimWeeklyRaffleRun.mockResolvedValue(true);
    mocks.completeWeeklyRaffleRun.mockResolvedValue(undefined);
    mocks.getWeeklyVolumeRows.mockResolvedValue([]);
    mocks.getUsersByIds.mockResolvedValue([]);
    mocks.upsertRewardLedgerEntries.mockResolvedValue([]);
    mocks.patchWeeklyReward.mockResolvedValue(undefined);
  });

  it("claims the week before reading volume rows", async () => {
    await runWeeklyRaffle({ weekStart: "2026-04-13T00:00:00.000Z" }, config());

    expect(mocks.claimWeeklyRaffleRun).toHaveBeenCalledWith(
      expect.any(Object),
      "season-1",
      "2026-04-13T00:00:00.000Z",
    );
    expect(mocks.getWeeklyVolumeRows).toHaveBeenCalled();
  });

  it("does not draw when another runner holds the claim", async () => {
    mocks.claimWeeklyRaffleRun.mockResolvedValue(false);

    const result = await runWeeklyRaffle({ weekStart: "2026-04-13T00:00:00.000Z" }, config());

    expect(result).toMatchObject({ alreadyRunning: true, winners: [] });
    expect(mocks.getWeeklyVolumeRows).not.toHaveBeenCalled();
    expect(mocks.upsertRewardLedgerEntries).not.toHaveBeenCalled();
  });

  it("marks the run completed once the draw finishes", async () => {
    await runWeeklyRaffle({ weekStart: "2026-04-13T00:00:00.000Z" }, config());

    expect(mocks.completeWeeklyRaffleRun).toHaveBeenCalledWith(
      expect.any(Object),
      "season-1",
      "2026-04-13T00:00:00.000Z",
      0,
    );
  });

  it("refuses to draw when there are fewer prizes than winners", async () => {
    // Prizes are handed out by index, so a short list silently paid later
    // winners nothing.
    await expect(
      runWeeklyRaffle(
        { weekStart: "2026-04-13T00:00:00.000Z" },
        config({ rafflePrizeAmounts: [50], weeklyWinnerCount: 3 }),
      ),
    ).rejects.toMatchObject({ code: "RAFFLE_MISCONFIGURED" });

    expect(mocks.claimWeeklyRaffleRun).not.toHaveBeenCalled();
  });

  it("releases the claim as failed when the draw throws", async () => {
    mocks.getWeeklyVolumeRows.mockRejectedValue(new Error("supabase down"));

    await expect(
      runWeeklyRaffle({ weekStart: "2026-04-13T00:00:00.000Z" }, config()),
    ).rejects.toThrow("supabase down");

    expect(mocks.completeWeeklyRaffleRun).toHaveBeenCalledWith(
      expect.any(Object),
      "season-1",
      "2026-04-13T00:00:00.000Z",
      0,
      "supabase down",
    );
  });
});
