import { describe, expect, it } from "vitest";

import {
  findStatusError,
  isRateLimitError,
  isRateLimitMessage,
  isRetryableLeverageError,
  isTradingAction,
  mapExchangeErrorMessage,
} from "./exchange-response";

describe("findStatusError", () => {
  it("finds the reason a rejected order carries, despite the 200", () => {
    expect(
      findStatusError({
        status: "ok",
        response: {
          data: {
            statuses: [{ error: "Order could not immediately match against any resting orders." }],
          },
        },
      }),
    ).toBe("Order could not immediately match against any resting orders.");
  });

  it("returns null when every status reports a fill or a rest", () => {
    expect(
      findStatusError({
        response: { data: { statuses: [{ resting: { oid: 123 } }] } },
      }),
    ).toBeNull();
    expect(
      findStatusError({
        response: { data: { statuses: [{ filled: { oid: 7, totalSz: "1" } }] } },
      }),
    ).toBeNull();
  });

  it("reports the first failure in a batch", () => {
    expect(
      findStatusError({
        response: {
          data: {
            statuses: [
              { resting: { oid: 1 } },
              { error: "Insufficient margin to place order." },
              { error: "second" },
            ],
          },
        },
      }),
    ).toBe("Insufficient margin to place order.");
  });

  it("treats a response without a statuses array as a success", () => {
    // Cancels and leverage updates answer in other shapes; only orders carry
    // statuses, and inventing an error for the rest would break them.
    expect(findStatusError({ status: "ok", response: { type: "cancel" } })).toBeNull();
    expect(findStatusError({})).toBeNull();
    expect(findStatusError(null)).toBeNull();
    expect(findStatusError(undefined)).toBeNull();
  });
});

describe("isTradingAction", () => {
  it("covers the actions that move an order", () => {
    expect(isTradingAction("placeOrder")).toBe(true);
    expect(isTradingAction("closePosition")).toBe(true);
    expect(isTradingAction("updateLeverage")).toBe(true);
  });

  it("excludes transfers and approvals", () => {
    expect(isTradingAction("usdClassTransfer")).toBe(false);
    expect(isTradingAction("approveAgent")).toBe(false);
    expect(isTradingAction("setUserAbstraction")).toBe(false);
  });
});

describe("mapExchangeErrorMessage", () => {
  it("explains an agent that is not linked to a funded account", () => {
    expect(
      mapExchangeErrorMessage(
        "placeOrder",
        "User or API Wallet must deposit before performing actions",
      ),
    ).toMatch(/not linked to a funded Hyperliquid account/);
  });

  it("says something different about the same failure on a transfer", () => {
    expect(
      mapExchangeErrorMessage(
        "usdClassTransfer",
        "User must deposit before performing actions",
      ),
    ).toMatch(/Transfer unavailable/);
  });

  it("translates the rejections a trader can act on", () => {
    expect(
      mapExchangeErrorMessage(
        "placeOrder",
        "Order price cannot be more than 95% away from the reference price",
      ),
    ).toMatch(/too far from the current market price/);
    expect(
      mapExchangeErrorMessage("placeOrder", "Order could not immediately match"),
    ).toMatch(/Try a limit order/);
    expect(
      mapExchangeErrorMessage("placeOrder", "Insufficient margin to place order"),
    ).toMatch(/Reduce size or lower leverage/);
  });

  it("only translates trading rejections for trading actions", () => {
    // The same text arriving from a transfer is not a trading rejection, and
    // pretending otherwise would tell the user to resize an order they never
    // placed.
    expect(
      mapExchangeErrorMessage("usdClassTransfer", "Insufficient margin"),
    ).toBeNull();
    expect(
      mapExchangeErrorMessage("approveAgent", "Could not immediately match"),
    ).toBeNull();
  });

  it("names the approval that failed", () => {
    expect(mapExchangeErrorMessage("setUserAbstraction", "boom")).toMatch(
      /Unified trading approval failed/,
    );
    expect(mapExchangeErrorMessage("setUserDexAbstraction", "boom")).toMatch(
      /HIP-3 abstraction approval failed/,
    );
  });

  it("reports rate limiting however it arrived", () => {
    const expected = "Rate limited — please try again in a moment.";
    expect(mapExchangeErrorMessage("placeOrder", "Request failed with 429")).toBe(expected);
    expect(mapExchangeErrorMessage("getMarkets", "Rate limit exceeded")).toBe(expected);
    // postInfo's own message once its backoff is spent.
    expect(mapExchangeErrorMessage("placeOrder", "Info request failed after retries")).toBe(expected);
  });

  it("passes an unrecognised message through untouched", () => {
    expect(mapExchangeErrorMessage("placeOrder", "Something new")).toBeNull();
    expect(mapExchangeErrorMessage("someOtherAction", "Insufficient margin")).toBeNull();
  });
});

describe("isRateLimitMessage", () => {
  it("matches what the transport reports", () => {
    expect(isRateLimitMessage("HTTP 429")).toBe(true);
    expect(isRateLimitMessage("Rate Limited")).toBe(true);
  });

  it("does not match an error that already exhausted its retries", () => {
    // retryOrder gates on this. Retrying a failure that is itself the result of
    // retrying would multiply the attempts against an exchange already refusing
    // them.
    expect(isRateLimitMessage("Info request failed after retries")).toBe(false);
  });

  it("only accepts Errors", () => {
    expect(isRateLimitError(new Error("429"))).toBe(true);
    expect(isRateLimitError("429")).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe("isRetryableLeverageError", () => {
  it("recognises a leverage rejection worth retrying without it", () => {
    expect(isRetryableLeverageError(new Error("Invalid leverage value"))).toBe(true);
    expect(isRetryableLeverageError(new Error("leverage is invalid for this market"))).toBe(true);
    expect(isRetryableLeverageError(new Error("Cannot switch margin mode: cross"))).toBe(true);
    expect(isRetryableLeverageError(new Error("isolated margin not allowed"))).toBe(true);
  });

  it("leaves unrelated failures to fail", () => {
    expect(isRetryableLeverageError(new Error("Insufficient margin"))).toBe(false);
    expect(isRetryableLeverageError(new Error("429"))).toBe(false);
    expect(isRetryableLeverageError("Invalid leverage value")).toBe(false);
    expect(isRetryableLeverageError(undefined)).toBe(false);
  });
});
