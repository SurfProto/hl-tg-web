import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getRewardsConfig: vi.fn(),
  getRewardsDashboard: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./_lib/config", () => ({ getRewardsConfig: mocks.getRewardsConfig }));
vi.mock("./_lib/program", () => ({ getRewardsDashboard: mocks.getRewardsDashboard }));

import handler from "./dashboard";

describe("POST /api/rewards/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRewardsConfig.mockReturnValue({ privyAppId: "app-id" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
    mocks.getRewardsDashboard.mockResolvedValue({});
  });

  /**
   * The identity comes from the verified session, never from the body. A body
   * naming another user's wallet must not select whose dashboard is returned.
   */
  it("does not forward client profile identity into the dashboard read", async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          username: "attacker",
          walletAddress: "0xattacker",
        },
      },
      response,
    );

    expect(mocks.getRewardsDashboard).toHaveBeenCalledWith(
      { privyUserId: "did:privy:user:1" },
      expect.anything(),
    );
  });

  /**
   * `startParam` used to link a referral as a side effect of loading the page.
   * Referrals are applied by /api/rewards/referral/apply now, so the parameter
   * must not reach the read path at all — a GET-shaped call is not a place to
   * decide who referred whom.
   */
  it("ignores a referral start parameter in the body", async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: { startParam: "ref_friend" },
      },
      response,
    );

    const [input] = mocks.getRewardsDashboard.mock.calls[0]!;
    expect(input).toEqual({ privyUserId: "did:privy:user:1" });
    expect(JSON.stringify(input)).not.toContain("ref_friend");
  });
});
