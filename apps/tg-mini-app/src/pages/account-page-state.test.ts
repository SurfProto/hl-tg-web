import { describe, expect, it } from "vitest";
import { getAccountOverviewStats } from "./account-page-state";

describe("getAccountOverviewStats", () => {
  it("maps overview stats from supported account state fields", () => {
    expect(
      getAccountOverviewStats({
        availableBalance: 125,
        withdrawableBalance: 95,
        marginSummary: {
          accountValue: 410,
          totalMarginUsed: 22,
        },
      } as any),
    ).toEqual({
      totalEquity: 410,
      marginLocked: 22,
      availableBalance: 125,
      withdrawableBalance: 95,
    });
  });
});
