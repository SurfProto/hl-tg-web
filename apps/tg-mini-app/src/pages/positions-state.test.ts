import { describe, expect, it } from "vitest";
import {
  getPositionsListViewState,
  getPositionsTabCount,
} from "./positions-state";

describe("getPositionsListViewState", () => {
  it("reports empty only when the server actually returned a list", () => {
    expect(
      getPositionsListViewState({
        hasValue: true,
        isLoading: false,
        isError: false,
        count: 0,
      }),
    ).toBe("empty");
  });

  it("reports ready when the list has rows", () => {
    expect(
      getPositionsListViewState({
        hasValue: true,
        isLoading: false,
        isError: false,
        count: 2,
      }),
    ).toBe("ready");
  });

  /**
   * The defect this module exists for: with no value yet, "no open positions"
   * is a claim about the account that nothing supports.
   */
  it("never reports empty while the snapshot is still in flight", () => {
    expect(
      getPositionsListViewState({
        hasValue: false,
        isLoading: true,
        isError: false,
        count: 0,
      }),
    ).toBe("loading");
  });

  it("reports error when the snapshot failed with nothing cached", () => {
    expect(
      getPositionsListViewState({
        hasValue: false,
        isLoading: false,
        isError: true,
        count: 0,
      }),
    ).toBe("error");
  });

  /**
   * Last known wins, the rule the balance hero learned the hard way: a failed
   * refetch must not blank a list already on screen.
   */
  it("keeps showing rows through a failed refetch", () => {
    expect(
      getPositionsListViewState({
        hasValue: true,
        isLoading: false,
        isError: true,
        count: 3,
      }),
    ).toBe("ready");
  });

  /**
   * Every account query is `enabled: Boolean(scope)`, and a disabled query
   * reports neither loading nor error. That is the window on a cold Telegram
   * launch where Privy has not resolved the user yet — it must read as
   * loading, not as an answered empty account.
   */
  it("treats a disabled query as loading rather than as an answer", () => {
    expect(
      getPositionsListViewState({
        hasValue: false,
        isLoading: false,
        isError: false,
        count: 0,
      }),
    ).toBe("loading");
  });
});

describe("getPositionsTabCount", () => {
  it("withholds the count until it is known", () => {
    expect(getPositionsTabCount("loading", 0)).toBeNull();
    expect(getPositionsTabCount("error", 0)).toBeNull();
  });

  it("shows the count once the list has answered", () => {
    expect(getPositionsTabCount("empty", 0)).toBe(0);
    expect(getPositionsTabCount("ready", 4)).toBe(4);
  });
});
