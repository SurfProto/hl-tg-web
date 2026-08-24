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

  if (
    trading &&
    lowerMessage.includes("must deposit before performing actions")
  ) {
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
  if (isUnknownSignerMessage(message)) {
    // Only main-wallet-signed actions reach this branch: an action the agent
    // signed is classified as an AgentAuthorizationError before mapping, so
    // "does not exist" here is about the account, not the API wallet. Either
    // way the raw message names an address, which is not something to put in
    // front of a user.
    return "This Hyperliquid account does not exist yet. Deposit funds into your main account to start trading.";
  }
  if (isRateLimitMessage(message) || lowerMessage.includes("after retries")) {
    return "Rate limited — please try again in a moment.";
  }

  return null;
}

/**
 * Whether a message is Hyperliquid saying the signer it was handed is unknown
 * to it.
 *
 * The exchange answers `User or API Wallet 0x… does not exist.` both when an
 * API wallet was deregistered and when the master account never deposited. The
 * two need opposite responses — reauthorize versus deposit — and the message
 * alone cannot tell them apart, so the caller has to supply which signer was
 * used. That is why this only reports the shape of the message.
 */
export function isUnknownSignerMessage(message: string): boolean {
  return /user or api wallet\b.*\bdoes not exist/i.test(message);
}

/** Every 0x-address in a string, replaced with a masked form. */
export function redactAddresses(message: string): string {
  return message
    .replace(/(?:0x)?[a-fA-F0-9]{64}\b/g, "[redacted-secret]")
    .replace(/0x[a-fA-F0-9]{40}\b/g, (address) => maskAddress(address));
}

/** `0x1234…cdef` — enough to correlate two reports, not enough to identify. */
export function maskAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The trading action a rejected authorization was attempting. */
export type TradingActionName = (typeof TRADING_ACTIONS)[number];

export type AgentRecoveryOutcome = "not-executed" | "partially-executed";

/**
 * A trading action rejected because the agent that signed it is not the agent
 * Hyperliquid holds.
 *
 * Thrown instead of a plain Error so the recovery path can key on the type
 * rather than re-matching a message, and so the pieces a user has to be shown —
 * which action failed, which agent was refused, what the exchange actually
 * said — survive the trip to the UI. The `message` is already user-facing and
 * carries no address; `exchangeMessage` keeps the original for the details
 * pane and for diagnostics, where it is redacted before leaving the device.
 */
export class AgentAuthorizationError extends Error {
  readonly code = "AGENT_AUTHORIZATION_REJECTED" as const;
  readonly action: string;
  readonly accountAddress: string;
  readonly agentAddress: string | null;
  readonly exchangeMessage: string;
  readonly outcome: AgentRecoveryOutcome;
  readonly occurredAt: number;

  constructor(args: {
    action: string;
    accountAddress: string;
    agentAddress: string | null;
    exchangeMessage: string;
    message: string;
    outcome?: AgentRecoveryOutcome;
    occurredAt?: number;
  }) {
    super(args.message);
    this.name = "AgentAuthorizationError";
    this.action = args.action;
    this.accountAddress = args.accountAddress;
    this.agentAddress = args.agentAddress;
    this.exchangeMessage = args.exchangeMessage;
    this.outcome = args.outcome ?? "not-executed";
    this.occurredAt = args.occurredAt ?? Date.now();
  }
}

/**
 * Whether the user declined the signature rather than anything failing.
 *
 * The distinction decides whether state changes at all: a declined signature
 * means nothing was sent and nothing should be torn down, while a failure
 * after signing leaves the result unknown. Wallets report the decline as
 * EIP-1193 code 4001, but the code does not always survive being wrapped, so
 * the message is checked too.
 */
export function isUserRejectedSignature(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code = (error as { code?: unknown }).code;
  if (code === 4001 || code === "ACTION_REJECTED") return true;

  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown }).message ?? "");

  return /user (rejected|denied)|rejected the request|denied (the )?(signature|transaction|message)/i.test(
    message,
  );
}

export function isAgentAuthorizationError(
  error: unknown,
): error is AgentAuthorizationError {
  return error instanceof AgentAuthorizationError;
}
