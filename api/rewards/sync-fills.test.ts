import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  backfillFillCheckpoints: vi.fn(),
  claimFillSyncBatch: vi.fn(),
  getOrCreateActiveSeason: vi.fn(),
  syncAccountFills: vi.fn(),
}));

vi.mock("./_lib/supabase-admin", () => ({
  backfillFillCheckpoints: mocks.backfillFillCheckpoints,
  claimFillSyncBatch: mocks.claimFillSyncBatch,
  getOrCreateActiveSeason: mocks.getOrCreateActiveSeason,
}));
vi.mock("./_lib/fill-sync", () => ({ syncAccountFills: mocks.syncAccountFills }));
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
    id: "season-1",
    starts_at: "2026-08-01T00:00:00.000Z",
  });
  mocks.backfillFillCheckpoints.mockResolvedValue(0);
  mocks.claimFillSyncBatch.mockResolvedValue([]);
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
