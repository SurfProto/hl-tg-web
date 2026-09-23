import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  backfillFillCheckpoints: vi.fn(),
  claimFillSyncBatch: vi.fn(),
  getOrCreateActiveSeason: vi.fn(),
  getSeasonBounds: vi.fn(),
  grantReferralMilestones: vi.fn(),
  rebuildProjections: vi.fn(),
  syncAccountDeposits: vi.fn(),
  syncAccountFills: vi.fn(),
}));

vi.mock("./_lib/supabase-admin", () => ({
  backfillFillCheckpoints: mocks.backfillFillCheckpoints,
  claimFillSyncBatch: mocks.claimFillSyncBatch,
  getOrCreateActiveSeason: mocks.getOrCreateActiveSeason,
  getSeasonBounds: mocks.getSeasonBounds,
  rebuildProjections: mocks.rebuildProjections,
}));
vi.mock("./_lib/deposits", () => ({ syncAccountDeposits: mocks.syncAccountDeposits }));
vi.mock("./_lib/fill-sync", () => ({ syncAccountFills: mocks.syncAccountFills }));
vi.mock("./_lib/referrals", () => ({ grantReferralMilestones: mocks.grantReferralMilestones }));
vi.mock("./_lib/config", () => ({
  getRewardsConfig: vi.fn(() => ({ hyperliquidTestnet: false, xpPerUsd: 1 })),
}));

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

const AUTHED = { headers: { authorization: "Bearer cron-secret" }, method: "GET" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  mocks.getOrCreateActiveSeason.mockResolvedValue({
    ends_at: "2026-09-01T00:00:00.000Z",
    id: "season-1",
    starts_at: "2026-08-01T00:00:00.000Z",
  });
  // Empty by default: the handler fills in the current season itself, so a
  // test only has to provide bounds for claims from other seasons.
  mocks.getSeasonBounds.mockResolvedValue(new Map());
  mocks.backfillFillCheckpoints.mockResolvedValue(0);
  mocks.claimFillSyncBatch.mockResolvedValue([]);
  mocks.rebuildProjections.mockResolvedValue({ pointsRows: 0, weeklyRows: 0 });
  mocks.grantReferralMilestones.mockResolvedValue({ granted: 0, milestones: 0 });
  mocks.syncAccountDeposits.mockResolvedValue({
    errorCode: null,
    eventsIngested: 0,
    externalEvents: 0,
    windowStartMs: 0,
  });
});

describe("/api/rewards/sync-fills", () => {
  it("rejects an unauthenticated request", async () => {
    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.claimFillSyncBatch).not.toHaveBeenCalled();
  });

  /**
   * The claim threshold releases a batch abandoned by a worker that died
   * mid-run. It is not a rate limiter — but at 900s against a ten-minute cron
   * it silently became one, and half the scheduled runs claimed nothing.
   */
  it("claims with a staleness threshold well inside the cron interval", async () => {
    const { CLAIM_STALE_AFTER_SECONDS, default: handler } = await import("./sync-fills");

    await handler(AUTHED, makeResponse());

    expect(mocks.claimFillSyncBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ staleAfterSeconds: CLAIM_STALE_AFTER_SECONDS }),
    );
  });

  /**
   * Reads the real schedule, so changing either side alone fails here rather
   * than quietly halving the sync rate in production.
   *
   * Requires meaningful headroom rather than merely "less than": cron ticks
   * land on fixed wall-clock minutes while last_attempt_at drifts to whenever
   * the run happened, so a threshold equal to the interval misses on the
   * boundary and an account waits a further full interval.
   */
  it("stays under the schedule declared in vercel.json", async () => {
    const { CLAIM_STALE_AFTER_SECONDS } = await import("./sync-fills");
    const vercelJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };

    const cron = vercelJson.crons?.find((entry) => entry.path === "/api/rewards/sync-fills");
    expect(cron, "sync-fills must be scheduled").toBeDefined();

    const everyNMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(cron!.schedule);
    expect(everyNMinutes, `unhandled schedule ${cron!.schedule}`).not.toBeNull();

    const intervalSeconds = Number(everyNMinutes![1]) * 60;
    expect(CLAIM_STALE_AFTER_SECONDS).toBeLessThanOrEqual(intervalSeconds / 2);
  });

  /**
   * The leaderboard ranks on `user_points.total_volume`. Making the dashboard
   * read-only removed the only writer and the worker never took over, so that
   * column sat frozen while the ledger moved on. Rebuilding once per run makes
   * the projection self-healing rather than dependent on every writer.
   */
  it("rebuilds the season projections after the batch", async () => {
    mocks.rebuildProjections.mockResolvedValue({ pointsRows: 2, weeklyRows: 3 });
    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();

    await handler(AUTHED, response);

    expect(mocks.rebuildProjections).toHaveBeenCalledWith(expect.anything(), "season-1");
    expect(response.body.data).toMatchObject({
      projectionPointsRows: 2,
      projectionWeeklyRows: 3,
    });
  });

  /**
   * Referral rungs depend on one user's activity and pay a different user, so
   * there is no account they belong to — they are granted once per run, and a
   * run that claims no accounts must still grant them.
   */
  it("grants referral milestones every run", async () => {
    mocks.grantReferralMilestones.mockResolvedValue({ granted: 4, milestones: 3 });
    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();

    await handler(AUTHED, response);

    expect(mocks.grantReferralMilestones).toHaveBeenCalledTimes(1);
    expect(response.body.data).toMatchObject({ referralMilestones: 3, referralRows: 4 });
  });

  // Even a run that claims nothing must reconcile: drift does not require
  // ingestion to have happened, only for a writer to have been wrong earlier.
  it("rebuilds projections even when no account is due", async () => {
    mocks.claimFillSyncBatch.mockResolvedValue([]);
    const { default: handler } = await import("./sync-fills");

    await handler(AUTHED, makeResponse());

    expect(mocks.rebuildProjections).toHaveBeenCalledTimes(1);
  });

  // One unreachable wallet must not stop everyone else's XP.
  it("continues past a failing account and reports it", async () => {
    mocks.claimFillSyncBatch.mockResolvedValue([
      { checkpointId: "cp-1", cursorTime: "2026-08-01T00:00:00.000Z", fillsIngested: 0, seasonId: "season-1", userId: "user-1", walletAddress: "0xaaaaaaaaaaaaaaaa" },
      { checkpointId: "cp-2", cursorTime: "2026-08-01T00:00:00.000Z", fillsIngested: 0, seasonId: "season-1", userId: "user-2", walletAddress: "0xbbbbbbbbbbbbbbbb" },
    ]);
    mocks.syncAccountFills
      .mockResolvedValueOnce({ errorCode: "EXCHANGE_UNAVAILABLE", fillsIngested: 0, grantsWritten: 0, requestCount: 0, retentionRisk: false, windowEndMs: 1, windowStartMs: 0 })
      .mockResolvedValueOnce({ errorCode: null, fillsIngested: 3, grantsWritten: 2, requestCount: 1, retentionRisk: false, windowEndMs: 1, windowStartMs: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();

    await handler(AUTHED, response);

    expect(mocks.syncAccountFills).toHaveBeenCalledTimes(2);
    expect(response.body.data).toMatchObject({
      accountsFailed: 1,
      accountsSynced: 1,
      fillsIngested: 3,
    });
  });

  /**
   * Each claim is bounded by its own season, and only the current one earns
   * quests. Passing the current season's bounds to every claim is exactly
   * the shape of the double grant: an August checkpoint read into September
   * because nothing told it where August ended.
   */
  it("bounds every claim by the season it belongs to", async () => {
    mocks.claimFillSyncBatch.mockResolvedValue([
      { checkpointId: "cp-old", cursorTime: "2026-07-31T23:50:00.000Z", fillsIngested: 0, seasonId: "season-0", userId: "user-1", walletAddress: "0xaaaaaaaaaaaaaaaa" },
      { checkpointId: "cp-now", cursorTime: "2026-08-01T00:00:00.000Z", fillsIngested: 0, seasonId: "season-1", userId: "user-1", walletAddress: "0xaaaaaaaaaaaaaaaa" },
    ]);
    mocks.getSeasonBounds.mockResolvedValue(
      new Map([["season-0", { endsAt: "2026-08-01T00:00:00.000Z", startsAt: "2026-07-01T00:00:00.000Z" }]]),
    );
    mocks.syncAccountFills.mockResolvedValue({
      errorCode: null, fillsIngested: 0, grantsWritten: 0, requestCount: 0,
      retentionRisk: false, windowEndMs: 1, windowStartMs: 0,
    });
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { default: handler } = await import("./sync-fills");
    await handler(AUTHED, makeResponse());

    expect(mocks.getSeasonBounds).toHaveBeenCalledWith(expect.anything(), ["season-0", "season-1"]);
    const byCheckpoint = new Map(
      mocks.syncAccountFills.mock.calls.map(([, claim, deps]) => [claim.checkpointId, deps]),
    );
    expect(byCheckpoint.get("cp-old")).toMatchObject({
      isCurrentSeason: false,
      seasonEndsAt: "2026-08-01T00:00:00.000Z",
    });
    expect(byCheckpoint.get("cp-now")).toMatchObject({
      isCurrentSeason: true,
      seasonEndsAt: "2026-09-01T00:00:00.000Z",
    });
  });

  /**
   * Until migration 030 runs, the old claim RPC still offers every stranded
   * August checkpoint. Each one would cost a deposit sync -- Supabase round
   * trips plus a Hyperliquid request -- and be counted as a successful sync
   * while reading nothing.
   */
  it("spends nothing on a closed season checkpoint that has already finished", async () => {
    mocks.claimFillSyncBatch.mockResolvedValue([
      { checkpointId: "cp-done", cursorTime: "2026-09-22T00:00:00.000Z", fillsIngested: 0, seasonId: "season-0", userId: "user-1", walletAddress: "0xaaaaaaaaaaaaaaaa" },
    ]);
    mocks.getSeasonBounds.mockResolvedValue(
      new Map([["season-0", { endsAt: "2026-08-01T00:00:00.000Z", startsAt: "2026-07-01T00:00:00.000Z" }]]),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();
    await handler(AUTHED, response);

    expect(mocks.syncAccountDeposits).not.toHaveBeenCalled();
    expect(mocks.syncAccountFills).not.toHaveBeenCalled();
    expect(response.body.data).toMatchObject({ accountsRetired: 1, accountsSynced: 0 });
  });

  /**
   * The run rebuilds the current season, and nothing else ever rebuilds a
   * closed one -- so grants written for a season's final stretch after it
   * ended would never reach that season's leaderboard.
   */
  it("rebuilds a closed season whose tail this run wrote", async () => {
    mocks.claimFillSyncBatch.mockResolvedValue([
      { checkpointId: "cp-tail", cursorTime: "2026-07-31T23:50:00.000Z", fillsIngested: 0, seasonId: "season-0", userId: "user-1", walletAddress: "0xaaaaaaaaaaaaaaaa" },
    ]);
    mocks.getSeasonBounds.mockResolvedValue(
      new Map([["season-0", { endsAt: "2026-08-01T00:00:00.000Z", startsAt: "2026-07-01T00:00:00.000Z" }]]),
    );
    mocks.syncAccountFills.mockResolvedValue({
      errorCode: null, fillsIngested: 2, grantsWritten: 2, requestCount: 1,
      retentionRisk: false, windowEndMs: 1, windowStartMs: 0,
    });
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();
    await handler(AUTHED, response);

    expect(mocks.rebuildProjections).toHaveBeenCalledWith(expect.anything(), "season-1");
    expect(mocks.rebuildProjections).toHaveBeenCalledWith(expect.anything(), "season-0");
    expect(response.body.data).toMatchObject({ closedSeasonsRebuilt: 1 });
  });

  it("skips a claim whose season cannot be found rather than reading it unbounded", async () => {
    mocks.claimFillSyncBatch.mockResolvedValue([
      { checkpointId: "cp-orphan", cursorTime: "2026-07-01T00:00:00.000Z", fillsIngested: 0, seasonId: "season-gone", userId: "user-1", walletAddress: "0xaaaaaaaaaaaaaaaa" },
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { default: handler } = await import("./sync-fills");
    const response = makeResponse();
    await handler(AUTHED, response);

    expect(mocks.syncAccountFills).not.toHaveBeenCalled();
    expect(mocks.syncAccountDeposits).not.toHaveBeenCalled();
    expect(response.body.data).toMatchObject({ accountsSkipped: 1, accountsSynced: 0 });
  });

  /**
   * Run logs are the one place this code routinely writes wallet identifiers,
   * and a full address in a log line is a durable, searchable link between an
   * internal user id and an on-chain identity.
   */
  it("never writes a full wallet address to the log", async () => {
    const wallet = "0xabcdef0123456789abcdef0123456789abcdef01";
    mocks.claimFillSyncBatch.mockResolvedValue([
      { checkpointId: "cp-1", cursorTime: "2026-08-01T00:00:00.000Z", fillsIngested: 0, seasonId: "season-1", userId: "user-1", walletAddress: wallet },
    ]);
    mocks.syncAccountFills.mockResolvedValue({
      errorCode: null, fillsIngested: 0, grantsWritten: 0, requestCount: 1,
      retentionRisk: false, windowEndMs: 1, windowStartMs: 0,
    });
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args) => void lines.push(args.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...args) => void lines.push(args.join(" ")));

    const { default: handler } = await import("./sync-fills");
    await handler(AUTHED, makeResponse());

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(wallet);
  });
});
