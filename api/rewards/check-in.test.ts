import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseAdmin = vi.hoisted(() => ({
  getActiveSeason: vi.fn(),
  getCheckInStreak: vi.fn(),
  getOrCreateRewardsUser: vi.fn(),
  getSeasonXpTotals: vi.fn(),
  upsertRewardLedgerEntries: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  getRewardsConfig: vi.fn(),
  requirePrivySession: vi.fn(),
}));

vi.mock("./_lib/supabase-admin", () => supabaseAdmin);
vi.mock("./_lib/config", () => ({ getRewardsConfig: mocks.getRewardsConfig }));
vi.mock("../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));

function makeResponse() {
  const res: any = {
    body: null,
    statusCode: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const REQUEST = { headers: { authorization: "Bearer token" }, method: "POST" };

function streak(overrides: Record<string, unknown> = {}) {
  return {
    availableToday: true,
    currentDays: 0,
    lastCheckInAt: null,
    longestDays: 0,
    ...overrides,
  };
}

function written() {
  return supabaseAdmin.upsertRewardLedgerEntries.mock.calls.flatMap(
    (call) => call[1] as Array<Record<string, unknown>>,
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getRewardsConfig.mockReturnValue({ privyAppId: "app" });
  mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
  supabaseAdmin.getOrCreateRewardsUser.mockResolvedValue({ id: "user-1" });
  supabaseAdmin.getActiveSeason.mockResolvedValue({ id: "season-1" });
  supabaseAdmin.getCheckInStreak.mockResolvedValue(streak());
  supabaseAdmin.getSeasonXpTotals.mockResolvedValue({
    checkInXp: 0,
    questXp: 0,
    referralBonusXp: 0,
    tierBonusXp: 0,
    totalXp: 0,
    volumeXp: 0,
  });
  supabaseAdmin.upsertRewardLedgerEntries.mockResolvedValue([]);
});

describe("POST /api/rewards/check-in", () => {
  it("grants the base reward on a first check-in", async () => {
    const { default: handler } = await import("./check-in");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.xpGranted).toBe(100);

    const entries = written();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      rewardKind: "xp",
      source: "daily_check_in",
      status: "posted",
    });
  });

  /**
   * The step rewards continuity rather than the act. The asymmetry between
   * building a streak over a week and losing it in a day is what brings someone
   * back on a day they were not going to trade.
   */
  it("pays more as the streak lengthens, up to a cap", async () => {
    const { checkInRewardFor } = await import("./check-in");

    expect(checkInRewardFor(0)).toBe(100);
    expect(checkInRewardFor(3)).toBe(175);
    expect(checkInRewardFor(6)).toBe(250);
    // Capped, so a very long streak does not run away with the season.
    expect(checkInRewardFor(60)).toBe(checkInRewardFor(6));
  });

  /**
   * The bonus is a separate row, never a multiplied amount. Folding it in would
   * make every historical total a function of today's rank, so a promotion
   * would silently rewrite what was earned last week.
   */
  it("writes the rank bonus as its own ledger row", async () => {
    // 12,000 season XP is Ridge, multiplier 1.25.
    supabaseAdmin.getSeasonXpTotals.mockResolvedValue({
      checkInXp: 0,
      questXp: 0,
      referralBonusXp: 0,
      tierBonusXp: 0,
      totalXp: 12_000,
      volumeXp: 12_000,
    });
    const { default: handler } = await import("./check-in");
    const response = makeResponse();

    await handler(REQUEST, response);

    const entries = written();
    expect(entries).toHaveLength(2);

    const base = entries.find((e) => e.source === "daily_check_in");
    const bonus = entries.find((e) => e.source === "tier_bonus");

    expect(base?.amount).toBe(100);
    expect(bonus?.amount).toBe(25);
    expect(response.body.data.xpGranted).toBe(125);
    expect(response.body.data.bonusXp).toBe(25);
  });

  it("writes no bonus row at the baseline rank", async () => {
    const { default: handler } = await import("./check-in");

    await handler(REQUEST, makeResponse());

    expect(written().some((e) => e.source === "tier_bonus")).toBe(false);
  });

  /**
   * Tapping twice is ordinary. The honest answer is the state they already
   * have, not an error telling them off.
   */
  it("is a no-op once today's check-in is taken", async () => {
    supabaseAdmin.getCheckInStreak.mockResolvedValue(
      streak({ availableToday: false, currentDays: 3 }),
    );
    const { default: handler } = await import("./check-in");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.alreadyCheckedIn).toBe(true);
    expect(response.body.data.xpGranted).toBe(0);
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
  });

  // The key is the UTC date, so a replay on the same day inserts nothing —
  // the append-only writer makes a second attempt free rather than an error.
  it("keys the grant by UTC date so a replay is a no-op", async () => {
    const { default: handler } = await import("./check-in");

    await handler(REQUEST, makeResponse());

    const key = written()[0]!.idempotencyKey as string;
    expect(key).toMatch(/^daily_check_in:season-1:user-1:\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses when no season is active rather than inventing one", async () => {
    supabaseAdmin.getActiveSeason.mockResolvedValue(null);
    const { default: handler } = await import("./check-in");
    const response = makeResponse();

    await handler(REQUEST, response);

    expect(response.statusCode).toBe(409);
    expect(response.body.code).toBe("NO_ACTIVE_SEASON");
    expect(supabaseAdmin.upsertRewardLedgerEntries).not.toHaveBeenCalled();
  });

  it("refuses anything but POST", async () => {
    const { default: handler } = await import("./check-in");
    const response = makeResponse();

    await handler({ ...REQUEST, method: "GET" }, response);

    expect(response.statusCode).toBe(405);
  });
});
