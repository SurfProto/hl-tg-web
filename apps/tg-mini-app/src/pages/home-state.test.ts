import { describe, expect, it } from "vitest";
import { getHomeMarketViewState } from "./home-state";

describe("getHomeMarketViewState", () => {
  it("keeps the first paint blocked only on market metadata", () => {
    expect(
      getHomeMarketViewState({
        marketsLoading: true,
        marketsError: false,
        marketCount: 0,
      }),
    ).toBe("loading");

    expect(
      getHomeMarketViewState({
        marketsLoading: false,
        marketsError: false,
        marketCount: 6,
      }),
    ).toBe("ready");
  });

  it("prefers an explicit error state when market metadata fails", () => {
    expect(
      getHomeMarketViewState({
        marketsLoading: false,
        marketsError: true,
        marketCount: 0,
      }),
    ).toBe("error");
  });

  it("only shows the empty state after a successful zero-market response", () => {
    expect(
      getHomeMarketViewState({
        marketsLoading: false,
        marketsError: false,
        marketCount: 0,
      }),
    ).toBe("empty");
  });
});
