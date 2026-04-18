import { beforeEach, describe, expect, it, vi } from "vitest";

const getRewardsConfig = vi.fn();
const requirePrivySession = vi.fn();
const applyReferralCode = vi.fn();

vi.mock("./_lib/config", () => ({
  getRewardsConfig,
}));

vi.mock("../onramp/_lib/auth", () => ({
  requirePrivySession,
}));

vi.mock("./_lib/program", () => ({
  applyReferralCode,
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

describe("/api/rewards/referral/apply", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getRewardsConfig.mockReturnValue({ privyAppId: "privy-app-id" });
    requirePrivySession.mockResolvedValue({ privyUserId: "privy-user-1" });
  });

  it("applies a valid referral code for an authenticated user", async () => {
    applyReferralCode.mockResolvedValue({
      referralCode: "FRIEND42",
      referredCount: 0,
      fundedReferralCount: 0,
      hasReferrer: true,
    });
    const { default: handler } = await import("./referral/apply");
    const response = makeResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { referralCode: "friend42" },
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        referralCode: "FRIEND42",
        hasReferrer: true,
      },
    });
    expect(applyReferralCode).toHaveBeenCalledWith(
      "privy-user-1",
      "friend42",
      expect.any(Object),
    );
  });

  it("rejects users who already have a referrer", async () => {
    const { HttpError } = await import("../onramp/_lib/http");
    applyReferralCode.mockRejectedValue(
      new HttpError(409, "REFERRAL_ALREADY_SET", "Referral code already applied"),
    );
    const { default: handler } = await import("./referral/apply");
    const response = makeResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { referralCode: "friend42" },
      },
      response,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: "REFERRAL_ALREADY_SET",
    });
  });
});
