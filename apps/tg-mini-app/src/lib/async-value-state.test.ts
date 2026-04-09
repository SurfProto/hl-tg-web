import { describe, expect, it } from "vitest";
import { getAsyncValueState } from "./async-value-state";

describe("getAsyncValueState", () => {
  it("returns ready when a concrete value is present", () => {
    expect(
      getAsyncValueState({
        hasValue: true,
        isLoading: false,
        isError: false,
      }),
    ).toBe("ready");
  });

  it("returns loading while the query is still pending", () => {
    expect(
      getAsyncValueState({
        hasValue: false,
        isLoading: true,
        isError: false,
      }),
    ).toBe("loading");
  });

  it("returns error after the query fails without data", () => {
    expect(
      getAsyncValueState({
        hasValue: false,
        isLoading: false,
        isError: true,
      }),
    ).toBe("error");
  });
});
