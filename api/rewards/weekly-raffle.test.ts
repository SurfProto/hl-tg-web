import { beforeEach, describe, expect, it, vi } from "vitest";

const runWeeklyRaffle = vi.fn();

vi.mock("./_lib/program", () => ({
  runWeeklyRaffle,
}));

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
    expect(runWeeklyRaffle).not.toHaveBeenCalled();
  });

  it("accepts authenticated cron GET requests", async () => {
    runWeeklyRaffle.mockResolvedValue({ winners: [] });
    const { default: handler } = await import("./weekly-raffle");
    const response = makeResponse();

    await handler(
      {
        method: "GET",
        headers: {
          authorization: "Bearer cron-secret",
        },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { winners: [] },
    });
    expect(runWeeklyRaffle).toHaveBeenCalledTimes(1);
  });

  it("accepts manual POST requests with the admin key", async () => {
    runWeeklyRaffle.mockResolvedValue({ winners: ["winner-1"] });
    const { default: handler } = await import("./weekly-raffle");
    const response = makeResponse();

    await handler(
      {
        method: "POST",
        headers: {
          "x-rewards-admin-key": "admin-secret",
        },
        body: { weekStart: "2026-04-14T00:00:00.000Z" },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { winners: ["winner-1"] },
    });
    expect(runWeeklyRaffle).toHaveBeenCalledWith(
      { weekStart: "2026-04-14T00:00:00.000Z" },
      expect.any(Object),
    );
  });
});
