import { describe, expect, it } from "vitest";

import {
  AgentAuthorizationError,
  findStatusError,
  isAgentAuthorizationError,
  isRateLimitError,
  isRateLimitMessage,
  isRetryableLeverageError,
  isTradingAction,
  isUnknownSignerMessage,
  isUserRejectedSignature,
  mapExchangeErrorMessage,
  maskAddress,
  redactAddresses,
} from "./exchange-response";

describe("findStatusError", () => {
  it("finds the reason a rejected order carries, despite the 200", () => {
    expect(
      findStatusError({
        status: "ok",
        response: {
          data: {
            statuses: [
              {
                error:
                  "Order could not immediately match against any resting orders.",
              },
            ],
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
        response: {
          data: { statuses: [{ filled: { oid: 7, totalSz: "1" } }] },
        },
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
    expect(
      findStatusError({ status: "ok", response: { type: "cancel" } }),
    ).toBeNull();
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
      mapExchangeErrorMessage(
        "placeOrder",
        "Order could not immediately match",
      ),
    ).toMatch(/Try a limit order/);
    expect(
      mapExchangeErrorMessage(
        "placeOrder",
        "Insufficient margin to place order",
      ),
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
    expect(
      mapExchangeErrorMessage("placeOrder", "Request failed with 429"),
    ).toBe(expected);
    expect(mapExchangeErrorMessage("getMarkets", "Rate limit exceeded")).toBe(
      expected,
    );
    // postInfo's own message once its backoff is spent.
    expect(
      mapExchangeErrorMessage(
        "placeOrder",
        "Info request failed after retries",
      ),
    ).toBe(expected);
  });

  it("passes an unrecognised message through untouched", () => {
    expect(mapExchangeErrorMessage("placeOrder", "Something new")).toBeNull();
    expect(
      mapExchangeErrorMessage("someOtherAction", "Insufficient margin"),
    ).toBeNull();
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
    expect(isRetryableLeverageError(new Error("Invalid leverage value"))).toBe(
      true,
    );
    expect(
      isRetryableLeverageError(
        new Error("leverage is invalid for this market"),
      ),
    ).toBe(true);
    expect(
      isRetryableLeverageError(new Error("Cannot switch margin mode: cross")),
    ).toBe(true);
    expect(
      isRetryableLeverageError(new Error("isolated margin not allowed")),
    ).toBe(true);
  });

  it("leaves unrelated failures to fail", () => {
    expect(isRetryableLeverageError(new Error("Insufficient margin"))).toBe(
      false,
    );
    expect(isRetryableLeverageError(new Error("429"))).toBe(false);
    expect(isRetryableLeverageError("Invalid leverage value")).toBe(false);
    expect(isRetryableLeverageError(undefined)).toBe(false);
  });
});

describe("isUnknownSignerMessage", () => {
  it("recognises the exchange refusing a signer it has no record of", () => {
    expect(
      isUnknownSignerMessage(
        "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.",
      ),
    ).toBe(true);
  });

  it("is not confused by the deposit message, which names the same pair", () => {
    // Both start "User or API Wallet". They need opposite advice, so the
    // difference has to be the part after the address, not the part before it.
    expect(
      isUnknownSignerMessage(
        "User or API Wallet must deposit before performing actions",
      ),
    ).toBe(false);
  });

  it("leaves unrelated failures alone", () => {
    expect(isUnknownSignerMessage("Insufficient margin")).toBe(false);
    expect(isUnknownSignerMessage("")).toBe(false);
  });
});

describe("AgentAuthorizationError", () => {
  it("keeps what a user has to be shown separate from what the exchange said", () => {
    const error = new AgentAuthorizationError({
      action: "closePosition",
      accountAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      agentAddress: "0x1234567890abcdef1234567890abcdef12345678",
      exchangeMessage:
        "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.",
      message: "Trading authorization is no longer valid.",
      occurredAt: 1_760_000_000_000,
    });

    expect(isAgentAuthorizationError(error)).toBe(true);
    expect(error.code).toBe("AGENT_AUTHORIZATION_REJECTED");
    expect(error.action).toBe("closePosition");
    expect(error.accountAddress).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(error.message).not.toMatch(/0x/);
    expect(error.exchangeMessage).toMatch(/does not exist/);
    expect(error).toBeInstanceOf(Error);
  });

  it("does not claim unrelated errors", () => {
    expect(isAgentAuthorizationError(new Error("Insufficient margin"))).toBe(
      false,
    );
    expect(isAgentAuthorizationError(null)).toBe(false);
  });
});

describe("mapExchangeErrorMessage, for an unknown signer", () => {
  it("answers a main-wallet rejection without repeating the address", () => {
    const mapped = mapExchangeErrorMessage(
      "withdraw",
      "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.",
    );

    expect(mapped).toMatch(/does not exist yet/i);
    expect(mapped).not.toMatch(/0x/);
  });
});

describe("redactAddresses", () => {
  it("masks every address in a message", () => {
    expect(
      redactAddresses(
        "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.",
      ),
    ).toBe("User or API Wallet 0x1234…5678 does not exist.");
  });

  it("masks each of several addresses", () => {
    const redacted = redactAddresses(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );

    expect(redacted).toBe("0xaaaa…aaaa and 0xbbbb…bbbb");
    expect(redacted).not.toMatch(/[a-f0-9]{40}/);
  });

  it("leaves a message with no address unchanged", () => {
    expect(redactAddresses("Insufficient margin")).toBe("Insufficient margin");
  });

  it("does not mistake a shorter hex string for an address", () => {
    expect(redactAddresses("order 0xdeadbeef failed")).toBe(
      "order 0xdeadbeef failed",
    );
  });

  it("removes a private key before looking for addresses inside it", () => {
    expect(redactAddresses(`failed ${"0x" + "ab".repeat(32)}`)).toBe(
      "failed [redacted-secret]",
    );
  });
});

describe("maskAddress", () => {
  it("keeps enough to correlate and drops the rest", () => {
    expect(maskAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(
      "0x1234…5678",
    );
  });

  it("leaves something too short to be worth masking", () => {
    expect(maskAddress("0x1234")).toBe("0x1234");
  });
});

describe("isUserRejectedSignature", () => {
  it("recognises the EIP-1193 rejection code", () => {
    expect(isUserRejectedSignature({ code: 4001 })).toBe(true);
    expect(isUserRejectedSignature({ code: "ACTION_REJECTED" })).toBe(true);
  });

  it("recognises the wording when the code did not survive wrapping", () => {
    expect(
      isUserRejectedSignature(new Error("User rejected the request")),
    ).toBe(true);
    expect(
      isUserRejectedSignature(new Error("user denied message signature")),
    ).toBe(true);
  });

  it("does not read a transport failure as a decision", () => {
    // The difference decides whether anything is torn down, so a network
    // failure must never be mistaken for the user saying no.
    expect(isUserRejectedSignature(new Error("fetch failed"))).toBe(false);
    expect(isUserRejectedSignature(new Error("429 rate limited"))).toBe(false);
    expect(isUserRejectedSignature(null)).toBe(false);
    expect(isUserRejectedSignature("user rejected")).toBe(false);
  });
});
