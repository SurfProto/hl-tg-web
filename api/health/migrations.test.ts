import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfileConfig: vi.fn(),
  supabaseRequest: vi.fn(),
}));

vi.mock("../profile/_lib/config", () => ({ getProfileConfig: mocks.getProfileConfig }));
vi.mock("../_lib/supabase", () => ({
  buildHeaders: () => ({}),
  supabaseRequest: mocks.supabaseRequest,
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

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.REWARDS_ADMIN_KEY = "admin-secret";
  mocks.getProfileConfig.mockReturnValue({});
  mocks.supabaseRequest.mockResolvedValue([
    { migration: "000_baseline_schema", marker: "users", present: true },
    { migration: "004_platform_orchestration", marker: "merchants", present: false },
    { migration: "024_price_alerts", marker: "price_alerts", present: false },
  ]);
});

describe("GET /api/health/migrations", () => {
  it("refuses without the admin key", async () => {
    const { default: handler } = await import("./migrations");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.supabaseRequest).not.toHaveBeenCalled();
  });

  it("reports genuinely missing migrations, not the deliberately parked ones", async () => {
    const { default: handler } = await import("./migrations");
    const response = makeResponse();

    await handler(
      { headers: { "x-rewards-admin-key": "admin-secret" }, method: "GET" },
      response,
    );

    expect(response.statusCode).toBe(200);
    // 004 is parked by design; 024 absent is real drift.
    expect(response.body.data.missing).toEqual(["024_price_alerts"]);
    expect(response.body.data.ok).toBe(false);
  });
});
