import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrivySession: vi.fn(),
  getRewardsConfig: vi.fn(),
  syncRewardsDashboard: vi.fn(),
}));

vi.mock("../onramp/_lib/auth", () => ({ requirePrivySession: mocks.requirePrivySession }));
vi.mock("./_lib/config", () => ({ getRewardsConfig: mocks.getRewardsConfig }));
vi.mock("./_lib/program", () => ({ syncRewardsDashboard: mocks.syncRewardsDashboard }));

import handler from "./dashboard";

describe("POST /api/rewards/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRewardsConfig.mockReturnValue({ privyAppId: "app-id" });
    mocks.requirePrivySession.mockResolvedValue({ privyUserId: "did:privy:user:1" });
    mocks.syncRewardsDashboard.mockResolvedValue({});
  });

  it("does not forward client profile identity into rewards synchronization", async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: {
          startParam: "ref_friend",
          username: "attacker",
          walletAddress: "0xattacker",
        },
      },
      response,
    );

    expect(mocks.syncRewardsDashboard).toHaveBeenCalledWith(
      {
        privyUserId: "did:privy:user:1",
        referralStartParam: "ref_friend",
      },
      expect.anything(),
    );
  });
});
