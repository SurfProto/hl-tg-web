import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRewardsConfig: vi.fn(),
  listWnftConversions: vi.fn(),
  reviewWnftConversion: vi.fn(),
}));

vi.mock("./_lib/config", () => ({ getRewardsConfig: mocks.getRewardsConfig }));
vi.mock("./_lib/supabase-admin", () => ({
  listWnftConversions: mocks.listWnftConversions,
  reviewWnftConversion: mocks.reviewWnftConversion,
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

const ADMIN = { headers: { "x-rewards-admin-key": "admin-secret" } };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getRewardsConfig.mockReturnValue({ rewardsAdminKey: "admin-secret" });
  mocks.listWnftConversions.mockResolvedValue([]);
  mocks.reviewWnftConversion.mockResolvedValue({
    id: "wnft-1",
    userId: "user-1",
    status: "confirmed",
  });
});

describe("/api/rewards/wnft", () => {
  it("refuses without the admin key", async () => {
    const { default: handler } = await import("./wnft");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.listWnftConversions).not.toHaveBeenCalled();
  });

  it("lists the provisional queue when asked", async () => {
    const { default: handler } = await import("./wnft");
    const response = makeResponse();

    await handler({ ...ADMIN, method: "GET", query: { status: "provisional" } }, response);

    expect(response.statusCode).toBe(200);
    expect(mocks.listWnftConversions).toHaveBeenCalledWith(
      expect.anything(),
      "provisional",
    );
  });

  it("ignores a bogus status filter rather than passing it through", async () => {
    const { default: handler } = await import("./wnft");
    const response = makeResponse();

    await handler({ ...ADMIN, method: "GET", query: { status: "haxx" } }, response);

    expect(mocks.listWnftConversions).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it("records a confirmation with reviewer and reason", async () => {
    const { default: handler } = await import("./wnft");
    const response = makeResponse();

    await handler(
      {
        ...ADMIN,
        method: "POST",
        body: {
          userId: "user-1",
          decision: "confirmed",
          reviewedBy: "alice",
          reason: "verified genuine repeat trader",
        },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.reviewWnftConversion).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "confirmed",
      "alice",
      "verified genuine repeat trader",
    );
  });

  it("refuses a decision missing a reason", async () => {
    const { default: handler } = await import("./wnft");
    const response = makeResponse();

    await handler(
      {
        ...ADMIN,
        method: "POST",
        body: { userId: "user-1", decision: "rejected", reviewedBy: "alice", reason: "" },
      },
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(mocks.reviewWnftConversion).not.toHaveBeenCalled();
  });

  it("409s when there is no provisional record to review", async () => {
    mocks.reviewWnftConversion.mockResolvedValue(null);
    const { default: handler } = await import("./wnft");
    const response = makeResponse();

    await handler(
      {
        ...ADMIN,
        method: "POST",
        body: { userId: "user-x", decision: "confirmed", reviewedBy: "alice", reason: "ok" },
      },
      response,
    );

    expect(response.statusCode).toBe(409);
  });
});
