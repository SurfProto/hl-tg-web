import { afterEach, describe, expect, it, vi } from "vitest";
import { applyReferralCode, fetchRewardsDashboard } from "./rewards";

describe("fetchRewardsDashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces plain-text API failures without throwing a JSON parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        headers: {
          get: () => "text/plain; charset=utf-8",
        },
        ok: false,
        text: async () => "A server error has occurred",
      }),
    );

    await expect(
      fetchRewardsDashboard("token", {
        startParam: null,
        username: null,
        walletAddress: null,
      }),
    ).rejects.toThrow("Rewards API /api/rewards/dashboard returned non-JSON");
  });

  it("posts manual referral application requests", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      headers: {
        get: () => "application/json",
      },
      ok: true,
      text: async () =>
        JSON.stringify({
          success: true,
          data: {
            referralCode: "FRIEND42",
            referredCount: 1,
            fundedReferralCount: 1,
            hasReferrer: true,
          },
        }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await applyReferralCode("token", { referralCode: "friend42" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rewards/referral/apply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ referralCode: "friend42" }),
      }),
    );
    expect(result).toMatchObject({
      referralCode: "FRIEND42",
      hasReferrer: true,
    });
  });
});
