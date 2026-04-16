import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRewardsDashboard } from "./rewards";

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
});
