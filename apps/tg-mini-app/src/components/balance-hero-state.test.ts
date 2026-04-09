import { describe, expect, it } from "vitest";
import { getBalanceHeroValueState } from "./balance-hero-state";

describe("getBalanceHeroValueState", () => {
  it("stays in loading state while user state is pending", () => {
    expect(
      getBalanceHeroValueState({
        userState: undefined,
        isLoading: true,
        isError: false,
      }),
    ).toEqual({
      state: "loading",
      totalValue: null,
      availableValue: null,
    });
  });

  it("returns an error state instead of confirmed zeroes on fetch failure", () => {
    expect(
      getBalanceHeroValueState({
        userState: undefined,
        isLoading: false,
        isError: true,
      }),
    ).toEqual({
      state: "error",
      totalValue: null,
      availableValue: null,
    });
  });

  it("returns ready values from normalized user state", () => {
    expect(
      getBalanceHeroValueState({
        userState: {
          availableBalance: 275,
          marginSummary: {
            accountValue: 410,
          },
        } as any,
        isLoading: false,
        isError: false,
      }),
    ).toEqual({
      state: "ready",
      totalValue: 410,
      availableValue: 275,
    });
  });
});
