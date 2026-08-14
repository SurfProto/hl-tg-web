/**
 * Reading what the exchange said back, extracted from client.ts.
 *
 * Two decisions live here: whether a response that arrived with HTTP 200 is
 * actually a failure, and what a user is told when something throws. Both were
 * private to the client class and neither had tests, though between them they
 * decide whether the app believes an order was placed.
 */

/** Actions that place, change or cancel an order — as opposed to transfers and approvals. */
const TRADING_ACTIONS = [
  "cancelAllOrders",
  "cancelPositionProtection",
  "cancelOrder",
  "closePosition",
  "modifyOrder",
  "placeOrder",
  "placeSpotOrder",
  "placeTriggerOrder",
  "upsertPositionProtection",
  "updateIsolatedMargin",
  "updateLeverage",
] as const;

export function isTradingAction(action: string): boolean {
  return (TRADING_ACTIONS as readonly string[]).includes(action);
}

/**
 * Whether a message reports rate limiting from the transport.
 *
 * Deliberately does not match "after retries", the message postInfo throws once
 * its own backoff is exhausted: that one is already the *result* of retrying,
 * so retrying it again would multiply the attempts. It still reads as rate
 * limiting to a user, which is why the message mapper below tests for it
 * separately.
 */
export function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("429") || lower.includes("rate limit");
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && isRateLimitMessage(error.message);
}

/**
 * A leverage rejection worth retrying without leverage rather than failing.
 *
 * The exchange rejects a leverage update for a market whose margin mode does
 * not allow it, and the order itself would have been fine.
 */
export function isRetryableLeverageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("invalid leverage value") ||
    (message.includes("leverage") && message.includes("invalid")) ||
    (message.includes("margin") &&
      (message.includes("cross") || message.includes("isolated")))
  );
}

/**
 * The error a rejected order carries, or null if the response reports success.
 *
 * Hyperliquid answers a rejected order with HTTP 200 and the reason buried in
 * `response.response.data.statuses[]`. A caller that only checked for a thrown
 * error would report a rejected order as placed.
 */
export function findStatusError(response: unknown): string | null {
  const statuses = (response as any)?.response?.data?.statuses;
  if (!Array.isArray(statuses)) return null;

  const errorStatus = statuses.find((status: any) => status?.error);
  return errorStatus?.error ?? null;
}

/**
 * The user-facing message for a failed action, or null to pass the original
 * message through.
 *
 * Separated from the throwing so the mapping can be tested as data. The
 * original error is logged by the caller before this runs: every branch here
 * discards it, and a trading action that failed during metadata resolution
 * surfacing only as "Rate limited" is what made that necessary.
 */
export function mapExchangeErrorMessage(
  action: string,
  message: string,
): string | null {
  const lowerMessage = message.toLowerCase();
  const trading = isTradingAction(action);

  if (trading && lowerMessage.includes("must deposit before performing actions")) {
    return "Trading agent is not linked to a funded Hyperliquid account. Re-run trading setup or deposit funds into your main account.";
  }
  if (
    action === "usdClassTransfer" &&
    lowerMessage.includes("must deposit before performing actions")
  ) {
    return "Transfer unavailable until your main Hyperliquid account has a deposit. Deposit funds first, then try again.";
  }
  if (
    trading &&
    lowerMessage.includes(
      "order price cannot be more than 95% away from the reference price",
    )
  ) {
    return "Order price is too far from the current market price. Adjust your price and try again.";
  }
  if (trading && lowerMessage.includes("could not immediately match")) {
    return "Market order couldn't fill — no matching orders available. Try a limit order.";
  }
  if (trading && lowerMessage.includes("insufficient margin")) {
    return "Insufficient margin for this order size. Reduce size or lower leverage.";
  }
  if (action === "setUserAbstraction") {
    return "Unified trading approval failed. Approve the signature in your wallet and try again.";
  }
  if (action === "setUserDexAbstraction") {
    return "HIP-3 abstraction approval failed. Approve the signature in your wallet and try again.";
  }
  if (isRateLimitMessage(message) || lowerMessage.includes("after retries")) {
    return "Rate limited — please try again in a moment.";
  }

  return null;
}
