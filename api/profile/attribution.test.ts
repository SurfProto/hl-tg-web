import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getProfileConfig: vi.fn(),
  getProfileByPrivyUserId: vi.fn(),
  recordFirstTouch: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./_lib/config", () => ({ getProfileConfig: mocks.getProfileConfig }));
vi.mock("./_lib/supabase-admin", () => ({
  getProfileByPrivyUserId: mocks.getProfileByPrivyUserId,
  recordFirstTouch: mocks.recordFirstTouch,
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

const REQ = { headers: { authorization: "Bearer t" }, method: "POST" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getProfileConfig.mockReturnValue({ privyAppId: "app" });
  mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:1" });
  mocks.getProfileByPrivyUserId.mockResolvedValue({ id: "user-1" });
  mocks.recordFirstTouch.mockResolvedValue(undefined);
});

describe("POST /api/profile/attribution", () => {
  it("records a campaign first touch for the caller's own profile", async () => {
    const { default: handler } = await import("./attribution");
    const response = makeResponse();

    await handler(
      { ...REQ, body: { source: "campaign", campaignCode: "twitter_launch", rawStartParam: "twitter_launch" } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.recordFirstTouch).toHaveBeenCalledWith(expect.anything(), "user-1", {
      source: "campaign",
      campaignCode: "twitter_launch",
      rawStartParam: "twitter_launch",
    });
  });

  it("nulls a campaign code that fails server-side validation", async () => {
    const { default: handler } = await import("./attribution");
    const response = makeResponse();

    await handler(
      { ...REQ, body: { source: "campaign", campaignCode: "has spaces", rawStartParam: "raw" } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.recordFirstTouch).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({ campaignCode: null }),
    );
  });

  it("rejects an unknown source", async () => {
    const { default: handler } = await import("./attribution");
    const response = makeResponse();

    await handler({ ...REQ, body: { source: "smuggled" } }, response);

    expect(response.statusCode).toBe(400);
    expect(mocks.recordFirstTouch).not.toHaveBeenCalled();
  });

  it("records direct with no code", async () => {
    const { default: handler } = await import("./attribution");
    const response = makeResponse();

    await handler({ ...REQ, body: { source: "direct" } }, response);

    expect(response.statusCode).toBe(200);
    expect(mocks.recordFirstTouch).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      { source: "direct", campaignCode: null, rawStartParam: null },
    );
  });
});
