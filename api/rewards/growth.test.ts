import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRewardsConfig: vi.fn(),
  listUserAttributions: vi.fn(),
  listWnftConversions: vi.fn(),
  getFundedUserIds: vi.fn(),
  getLastActivityByUser: vi.fn(),
  listCampaignSpend: vi.fn(),
}));

vi.mock("./_lib/config", () => ({ getRewardsConfig: mocks.getRewardsConfig }));
vi.mock("./_lib/supabase-admin", () => ({
  listUserAttributions: mocks.listUserAttributions,
  listWnftConversions: mocks.listWnftConversions,
  getFundedUserIds: mocks.getFundedUserIds,
  getLastActivityByUser: mocks.getLastActivityByUser,
  listCampaignSpend: mocks.listCampaignSpend,
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

const ADMIN = { headers: { "x-rewards-admin-key": "admin-secret" }, method: "GET" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getRewardsConfig.mockReturnValue({ rewardsAdminKey: "admin-secret" });
  mocks.listUserAttributions.mockResolvedValue([
    { userId: "u1", source: "campaign", campaignCode: "twitter", firstSeenAt: "2026-02-01T00:00:00.000Z" },
  ]);
  mocks.listWnftConversions.mockResolvedValue([{ userId: "u1", status: "confirmed" }]);
  mocks.getFundedUserIds.mockResolvedValue(["u1"]);
  mocks.getLastActivityByUser.mockResolvedValue([
    { userId: "u1", lastOccurredAt: "2026-02-20T00:00:00.000Z" },
  ]);
  mocks.listCampaignSpend.mockResolvedValue([{ campaignCode: "twitter", spendUsd: 50 }]);
});

describe("GET /api/rewards/growth", () => {
  it("refuses without the admin key", async () => {
    const { default: handler } = await import("./growth");
    const response = makeResponse();

    await handler({ headers: {}, method: "GET" }, response);

    expect(response.statusCode).toBe(401);
    expect(mocks.listUserAttributions).not.toHaveBeenCalled();
  });

  it("stitches the sources into a per-channel funnel with CAC", async () => {
    const { default: handler } = await import("./growth");
    const response = makeResponse();

    await handler(ADMIN, response);

    expect(response.statusCode).toBe(200);
    const twitter = response.body.data.channels.find((c: any) => c.channel === "twitter");
    expect(twitter).toMatchObject({
      authedUsers: 1,
      fundedUsers: 1,
      wnftConfirmed: 1,
      d7Active: 1, // active Feb 20, joined Feb 1 → retained
      spendUsd: 50,
      cacUsd: 50,
    });
    expect(response.body.data.totals.authedUsers).toBe(1);
  });
});
