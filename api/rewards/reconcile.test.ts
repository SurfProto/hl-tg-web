import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSeason: vi.fn(),
  getReconciliationReport: vi.fn(),
  getXpProjectionDrift: vi.fn(),
  rebuildXpProjection: vi.fn(),
}));

vi.mock("./_lib/supabase-admin", () => mocks);
vi.mock("./_lib/config", () => ({
  getRewardsConfig: vi.fn(() => ({ rewardsAdminKey: "admin-secret" })),
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

const ADMIN = { "x-rewards-admin-key": "admin-secret" };

const REPORT = {
  accountsFailing: 0,
  accountsNeverSynced: 0,
  accountsRetentionRisk: 0,
  accountsStale: 0,
  accountsTotal: 2,
  driftAccounts: 1,
  driftTotalXp: 103,
  fillsIngested: 0,
  heldCashAmount: 0,
  heldCashRows: 0,
  maxIngestionLagSeconds: 986_400,
  oldestCursorTime: "2026-08-15T00:00:00.000Z",
  walletsWithoutCheckpoint: 0,
};

const DRIFT = [{ driftXp: 103, ledgerXp: 1001, projectedXp: 1104, userId: "user-1" }];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getActiveSeason.mockResolvedValue({ id: "season-1", name: "August 2026" });
  mocks.getReconciliationReport.mockResolvedValue(REPORT);
  mocks.getXpProjectionDrift.mockResolvedValue(DRIFT);
  mocks.rebuildXpProjection.mockResolvedValue(1);
});

describe("/api/rewards/reconcile", () => {
  it("rejects a request without the admin key", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.getReconciliationReport).not.toHaveBeenCalled();
  });

  /**
   * The split that matters: reporting is reachable only through a verb that
   * cannot write. A reconciliation tool that mutates by default cannot answer
   * "is anything wrong?", because running it destroys the evidence.
   */
  it("writes nothing when reporting", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.report).toEqual(REPORT);
    expect(mocks.rebuildXpProjection).not.toHaveBeenCalled();
  });

  it("reports drift detail alongside the summary", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.body.data.drift).toEqual(DRIFT);
    expect(response.body.data.season).toEqual({ id: "season-1", name: "August 2026" });
  });

  // Reconciliation reports on what exists. Inventing a season in order to have
  // something to report on would be absurd.
  it("refuses rather than creating a season when none is active", async () => {
    mocks.getActiveSeason.mockResolvedValue(null);
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ code: "NO_ACTIVE_SEASON", success: false });
  });

  it("repairs only when given a named action", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ body: { action: "rebuild_xp_projection" }, headers: ADMIN, method: "POST" }, response);

    expect(response.statusCode).toBe(200);
    expect(mocks.rebuildXpProjection).toHaveBeenCalledWith(expect.anything(), "season-1");
    expect(response.body.data.rowsUpdated).toBe(1);
  });

  it("rejects an unrecognised action without touching anything", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ body: { action: "drop_everything" }, headers: ADMIN, method: "POST" }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: "UNKNOWN_REPAIR_ACTION" });
    expect(mocks.rebuildXpProjection).not.toHaveBeenCalled();
  });

  it("rejects a POST with no action at all", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ body: {}, headers: ADMIN, method: "POST" }, response);

    expect(response.statusCode).toBe(400);
    expect(mocks.rebuildXpProjection).not.toHaveBeenCalled();
  });

  /**
   * "One row changed" is not a reviewable record of a repair. Capturing the
   * disagreement either side of the write is what lets somebody afterwards
   * judge whether the repair was the right thing to have done.
   */
  it("records the disagreement either side of a repair", async () => {
    mocks.getXpProjectionDrift.mockResolvedValueOnce(DRIFT).mockResolvedValueOnce([]);
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ body: { action: "rebuild_xp_projection" }, headers: ADMIN, method: "POST" }, response);

    expect(response.body.data.driftBefore).toEqual(DRIFT);
    expect(response.body.data.driftAfter).toEqual([]);
  });

  it("requires the admin key to repair", async () => {
    const { default: handler } = await import("./reconcile");
    const response = makeResponse();

    await handler({ body: { action: "rebuild_xp_projection" }, headers: {}, method: "POST" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.rebuildXpProjection).not.toHaveBeenCalled();
  });
});
