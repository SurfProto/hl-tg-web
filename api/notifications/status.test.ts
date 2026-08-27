import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNotificationsStatus: vi.fn(),
  getProfileConfig: vi.fn(),
}));

vi.mock("./_lib/supabase-admin", () => ({
  getNotificationsStatus: mocks.getNotificationsStatus,
}));
vi.mock("../profile/_lib/config", () => ({ getProfileConfig: mocks.getProfileConfig }));

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

/** A pipeline that is running and has nothing to say. */
const HEALTHY = {
  channelsActive: 2,
  channelsFailing: 0,
  channelsTotal: 2,
  cursorsTracked: 6,
  cursorsUninitialised: 0,
  eventsFailed: 0,
  eventsPending: 0,
  eventsSent: 1,
  eventsSent24h: 0,
  lastErrorCode: null,
  oldestPendingSeconds: 0,
  usersWithPreferences: 1,
  workerLagSeconds: 20,
  workerLastRunAt: "2026-08-27T09:44:19.841Z",
  workerStale: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.REWARDS_ADMIN_KEY = "admin-secret";
  mocks.getProfileConfig.mockReturnValue({ privyAppId: "app" });
  mocks.getNotificationsStatus.mockResolvedValue(HEALTHY);
});

describe("GET /api/notifications/status", () => {
  it("rejects a request without the admin key", async () => {
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.getNotificationsStatus).not.toHaveBeenCalled();
  });

  it("refuses anything but GET", async () => {
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "POST" }, response);

    expect(response.statusCode).toBe(405);
  });

  /**
   * The distinction the endpoint exists for. Zero events is the normal state of
   * a healthy pipeline with nothing to report — the worker was declared dead on
   * exactly that evidence while it was running every minute.
   */
  it("calls a quiet but running pipeline healthy", async () => {
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.verdict).toBe("healthy");
    expect(response.body.data.report.eventsSent24h).toBe(0);
  });

  // Worker lag is the load-bearing signal: it touches runtime state every pass,
  // so a stale cursor means it stopped whatever the event counts say.
  it("reports a stopped worker even with no failures", async () => {
    mocks.getNotificationsStatus.mockResolvedValue({
      ...HEALTHY,
      workerLagSeconds: 4_000,
      workerStale: true,
    });
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.body.data.verdict).toBe("worker_stale");
  });

  it("reports degraded delivery when a channel is failing", async () => {
    mocks.getNotificationsStatus.mockResolvedValue({
      ...HEALTHY,
      channelsFailing: 1,
      lastErrorCode: "403",
    });
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.body.data.verdict).toBe("delivery_degraded");
  });

  it("reports degraded delivery when events are failing", async () => {
    mocks.getNotificationsStatus.mockResolvedValue({ ...HEALTHY, eventsFailed: 3 });
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.body.data.verdict).toBe("delivery_degraded");
  });

  // A stale worker is the more serious of the two and must not be masked by a
  // failing channel arriving at the same time.
  it("prefers the stale verdict when both are true", async () => {
    mocks.getNotificationsStatus.mockResolvedValue({
      ...HEALTHY,
      channelsFailing: 1,
      eventsFailed: 2,
      workerStale: true,
    });
    const { default: handler } = await import("./status");
    const response = makeResponse();

    await handler({ headers: ADMIN, method: "GET" }, response);

    expect(response.body.data.verdict).toBe("worker_stale");
  });
});
