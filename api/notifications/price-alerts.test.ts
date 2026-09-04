import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deletePriceAlert: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
  getProfileConfig: vi.fn(),
  insertPriceAlert: vi.fn(),
  listPriceAlerts: vi.fn(),
  requirePrivySession: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("../profile/_lib/config", () => ({ getProfileConfig: mocks.getProfileConfig }));
vi.mock("../profile/_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
}));
vi.mock("./_lib/supabase-admin", () => ({
  deletePriceAlert: mocks.deletePriceAlert,
  insertPriceAlert: mocks.insertPriceAlert,
  listPriceAlerts: mocks.listPriceAlerts,
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

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "alert-1",
    coin: "BTC",
    targetPx: 110_000,
    direction: "above",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getProfileConfig.mockReturnValue({ privyAppId: "app" });
  mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
  mocks.getProfileByPrivyUserId.mockResolvedValue({ id: "user-1" });
  mocks.listPriceAlerts.mockResolvedValue([]);
  mocks.insertPriceAlert.mockResolvedValue(makeAlert());
  mocks.deletePriceAlert.mockResolvedValue(true);
});

describe("/api/notifications/price-alerts", () => {
  it("arms a valid alert for the caller's own profile", async () => {
    const { default: handler } = await import("./price-alerts");
    const response = makeResponse();

    await handler(
      {
        headers: {},
        method: "POST",
        body: { coin: "BTC", targetPx: 110000, direction: "above" },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.insertPriceAlert).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      { coin: "BTC", direction: "above", targetPx: 110000 },
    );
  });

  it("rejects garbage instead of arming it", async () => {
    const { default: handler } = await import("./price-alerts");

    for (const body of [
      { coin: "BTC", targetPx: -5, direction: "above" },
      { coin: "BTC", targetPx: 100, direction: "sideways" },
      { coin: "BTC; drop table users", targetPx: 100, direction: "above" },
      { coin: "BTC", targetPx: Number.NaN, direction: "below" },
    ]) {
      const response = makeResponse();
      await handler({ headers: {}, method: "POST", body }, response);
      expect(response.statusCode).toBe(400);
    }
    expect(mocks.insertPriceAlert).not.toHaveBeenCalled();
  });

  it("caps the number of armed alerts, because the worker scans them all every minute", async () => {
    mocks.listPriceAlerts.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => makeAlert({ id: `alert-${index}` })),
    );
    const { default: handler } = await import("./price-alerts");
    const response = makeResponse();

    await handler(
      {
        headers: {},
        method: "POST",
        body: { coin: "BTC", targetPx: 110000, direction: "above" },
      },
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body.error ?? response.body.code ?? "").toBeTruthy();
    expect(mocks.insertPriceAlert).not.toHaveBeenCalled();
  });

  it("404s a delete that matched nothing, which is how another user's id looks", async () => {
    mocks.deletePriceAlert.mockResolvedValue(false);
    const { default: handler } = await import("./price-alerts");
    const response = makeResponse();

    await handler(
      { headers: {}, method: "DELETE", query: { id: "someone-elses" } },
      response,
    );

    expect(response.statusCode).toBe(404);
    // The delete is scoped to the caller's own user id — that filter is the
    // IDOR guard this pins.
    expect(mocks.deletePriceAlert).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "someone-elses",
    );
  });

  it("lists only via the caller's own profile id", async () => {
    mocks.listPriceAlerts.mockResolvedValue([makeAlert()]);
    const { default: handler } = await import("./price-alerts");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.alerts).toHaveLength(1);
    expect(mocks.listPriceAlerts).toHaveBeenCalledWith(expect.anything(), "user-1");
  });
});
