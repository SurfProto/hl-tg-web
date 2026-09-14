import { describe, expect, it } from "vitest";
import {
  getBalanceHeroDisplayState,
  getBalanceHeroValueState,
} from "./balance-hero-state";

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

  it("keeps showing the last-known balance when a refetch errors", () => {
    // The recurring "my balance disappeared": a single failed 5s poll set
    // isError while React Query still held the last good userState, and the
    // hero blanked to "unavailable" instead of showing what it had.
    expect(
      getBalanceHeroValueState({
        userState: {
          availableBalance: 275,
          marginSummary: { accountValue: 410 },
        } as any,
        isLoading: false,
        isError: true,
      }),
    ).toEqual({
      state: "ready",
      totalValue: 410,
      availableValue: 275,
    });
  });

  it("shows zero (not an error) in the signed-out / no-scope state", () => {
    expect(
      getBalanceHeroValueState({
        userState: undefined,
        isLoading: false,
        isError: false,
      }),
    ).toEqual({
      state: "ready",
      totalValue: 0,
      availableValue: 0,
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

  it("builds ready display details from supported balance fields", () => {
    expect(
      getBalanceHeroDisplayState({
        state: "ready",
        totalValue: 410,
        availableValue: 275,
      }),
    ).toEqual({
      highlightValue: 410,
      availableValue: 275,
    });
  });
});
