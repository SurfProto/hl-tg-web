import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/config", () => ({
  getRewardsConfig: vi.fn(() => ({
    rewardsAdminKey: "admin-secret",
  })),
}));

interface MockResponse {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function makeResponse(): MockResponse {
  return {
    statusCode: null,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("/api/rewards/weekly-raffle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
  });

  it("rejects unauthorized requests", async () => {
    const { default: handler } = await import("./weekly-raffle");
    const response = makeResponse();

    await handler({ method: "GET", headers: {} }, response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      code: "UNAUTHORIZED",
    });
  });

  // Authorization is still checked first and checked unchanged. An anonymous
  // caller learns nothing about which capabilities are switched off, and an
  // operator holding a valid key gets the specific reason rather than a 401
  // that would send them hunting for a credential problem.
  it("refuses an authenticated cron GET with REWARDS_XP_ONLY", async () => {
    const { default: handler } = await import("./weekly-raffle");
    const response = makeResponse();

    await handler(
      { method: "GET", headers: { authorization: "Bearer cron-secret" } },
      response,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "REWARDS_XP_ONLY",
    });
  });

  it("refuses an authenticated admin POST with REWARDS_XP_ONLY", async () => {
    const { default: handler } = await import("./weekly-raffle");
    const response = makeResponse();

    await handler(
      {
        method: "POST",
        headers: { "x-rewards-admin-key": "admin-secret" },
        body: { weekStart: "2026-04-14T00:00:00.000Z" },
      },
      response,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "REWARDS_XP_ONLY",
    });
  });

  /**
   * The refusal must not be an early return sitting on top of a live draw.
   *
   * `server-imports.test.ts` proves the route's module graph excludes
   * `_lib/raffle`; this asserts the observable half of the same claim, so that
   * re-importing the draw would have to break a test that reads like the
   * requirement it came from.
   */
  it("performs no database work while refusing", async () => {
    const supabaseAdmin = await import("./_lib/supabase-admin");
    const claim = vi.spyOn(supabaseAdmin, "claimWeeklyRaffleRun");
    const season = vi.spyOn(supabaseAdmin, "getOrCreateActiveSeason");
    const upsert = vi.spyOn(supabaseAdmin, "upsertRewardLedgerEntries");

    const { default: handler } = await import("./weekly-raffle");

    await handler(
      { method: "GET", headers: { authorization: "Bearer cron-secret" } },
      makeResponse(),
    );

    expect(season).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
