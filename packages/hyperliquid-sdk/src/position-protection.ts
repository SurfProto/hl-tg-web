import type { OrderSide } from "@repo/types";

/**
 * Stop-loss and take-profit decisions, extracted from
 * `client.upsertPositionProtection`.
 *
 * Which existing order counts as the stop loss, which side closes the position
 * and what actually needs cancelling are all decided here; the client is left
 * with the cancel-and-place sequence. The classifier was written twice — once
 * here and once in the app's protection.ts, with a comment in client.ts noting
 * the copy — so the SDK and the UI could in principle disagree about which
 * resting order is your stop.
 */

export type PositionDirection = "long" | "short";
export type ProtectionKind = "stopLoss" | "takeProfit";

/**
 * The part of an OpenOrder that protection decisions read. `isTrigger` and
 * `triggerPx` are optional because a plain limit order carries neither, and an
 * order missing them is simply not protection.
 */
export interface ProtectionOrder {
  oid: number;
  coin: string;
  reduceOnly: boolean;
  isTrigger?: boolean;
  triggerPx?: number | null;
}

export interface ProtectionPlan {
  direction: PositionDirection;
  /** The side that reduces the position: opposite to the way it points. */
  side: OrderSide;
  /** Absolute position size — a trigger order carries no sign. */
  size: number;
  cancelOids: number[];
  toPlace: Array<{ triggerPx: number; triggerKind: ProtectionKind }>;
}

/**
 * Whether a resting order protects a position, and on which side.
 *
 * A trigger below the mark closes a long at a loss and a short at a profit, so
 * the same price means opposite things depending on which way the position
 * points. An order exactly at the mark is neither.
 */
export function classifyProtectionOrder(
  order: Pick<ProtectionOrder, "isTrigger" | "reduceOnly" | "triggerPx">,
  direction: PositionDirection,
  currentPrice: number | null,
): ProtectionKind | null {
  if (
    !order.isTrigger ||
    !order.reduceOnly ||
    order.triggerPx == null ||
    currentPrice == null
  ) {
    return null;
  }

  if (direction === "long") {
    if (order.triggerPx < currentPrice) return "stopLoss";
    if (order.triggerPx > currentPrice) return "takeProfit";
  } else {
    if (order.triggerPx > currentPrice) return "stopLoss";
    if (order.triggerPx < currentPrice) return "takeProfit";
  }

  return null;
}

function assertUsableTrigger(price: number, label: string): void {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${label} trigger price must be greater than 0.`);
  }
}

/** The ways a trigger can sit on the wrong side of the mark price. */
export type ProtectionSideIssue =
  | "stopLossAboveMarkOnLong"
  | "stopLossBelowMarkOnShort"
  | "takeProfitBelowMarkOnLong"
  | "takeProfitAboveMarkOnShort";

export const PROTECTION_SIDE_MESSAGES: Record<ProtectionSideIssue, string> = {
  stopLossAboveMarkOnLong:
    "Stop loss must be below the current mark price for a long position.",
  stopLossBelowMarkOnShort:
    "Stop loss must be above the current mark price for a short position.",
  takeProfitBelowMarkOnLong:
    "Take profit must be above the current mark price for a long position.",
  takeProfitAboveMarkOnShort:
    "Take profit must be below the current mark price for a short position.",
};

/**
 * Which trigger, if any, sits on the wrong side of the mark price.
 *
 * Extracted so this rule can be applied BEFORE an order is placed as well as
 * inside `planPositionProtection`. It used to live only in the plan, which
 * runs after the entry order has already filled — so a stop set for a long
 * and then submitted as a short opened the position and only then refused the
 * stop, leaving a live leveraged trade with no protection and nothing but a
 * toast to say so. The UI can now refuse at the review step instead.
 *
 * Returns a code rather than a message because the caller decides the
 * wording: the SDK throws the English sentences above, the app translates.
 */
export function findProtectionSideIssue({
  direction,
  referencePrice,
  stopLossPx,
  takeProfitPx,
}: {
  direction: PositionDirection;
  referencePrice: number;
  stopLossPx?: number | null;
  takeProfitPx?: number | null;
}): ProtectionSideIssue | null {
  // Without a usable reference there is nothing to compare against, and
  // refusing on that basis would block an order for a price the app simply
  // has not fetched yet. The order path checks again with its own reference.
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null;

  const isLong = direction === "long";

  if (stopLossPx != null && Number.isFinite(stopLossPx)) {
    const valid = isLong
      ? stopLossPx < referencePrice
      : stopLossPx > referencePrice;
    if (!valid) {
      return isLong ? "stopLossAboveMarkOnLong" : "stopLossBelowMarkOnShort";
    }
  }

  if (takeProfitPx != null && Number.isFinite(takeProfitPx)) {
    const valid = isLong
      ? takeProfitPx > referencePrice
      : takeProfitPx < referencePrice;
    if (!valid) {
      return isLong ? "takeProfitBelowMarkOnLong" : "takeProfitAboveMarkOnShort";
    }
  }

  return null;
}

/**
 * Work out what to cancel and what to place so a position ends up with the
 * requested protection.
 *
 * Only the sides that changed are touched. Re-placing an unchanged stop would
 * leave the position unprotected for the moment between the cancel and the
 * new order landing, which is exactly the moment it matters.
 */
export function planPositionProtection({
  positionSzi,
  referencePrice,
  stopLossPx,
  takeProfitPx,
  existingOrders,
  marketName,
}: {
  positionSzi: number;
  referencePrice: number;
  stopLossPx: number | null;
  takeProfitPx: number | null;
  /** Open orders to diff against — empty when the caller skips cancelling. */
  existingOrders: ProtectionOrder[];
  marketName: string;
}): ProtectionPlan {
  if (!Number.isFinite(positionSzi) || positionSzi === 0) {
    throw new Error(
      `No open position to protect for ${marketName}.`,
    );
  }

  // The plan must not guess. findProtectionSideIssue tolerates an unusable
  // reference because its other caller runs before an order exists and must
  // not block on a price the app has merely not fetched yet; here a position
  // is already open, and placing triggers without knowing which side of the
  // mark they fall on is how an unprotected position gets called protected.
  // Before the rule was extracted this was implicit — every comparison against
  // NaN was false, so the old inline check threw.
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new Error(
      `No usable mark price for ${marketName}; cannot place protection orders.`,
    );
  }

  const isLong = positionSzi > 0;
  const direction: PositionDirection = isLong ? "long" : "short";
  const side: OrderSide = isLong ? "sell" : "buy";
  const size = Math.abs(positionSzi);

  if (stopLossPx != null) {
    assertUsableTrigger(stopLossPx, "Stop loss");
    const issue = findProtectionSideIssue({
      direction,
      referencePrice,
      stopLossPx,
    });
    if (issue) {
      throw new Error(PROTECTION_SIDE_MESSAGES[issue]);
    }
  }

  if (takeProfitPx != null) {
    assertUsableTrigger(takeProfitPx, "Take profit");
    const issue = findProtectionSideIssue({
      direction,
      referencePrice,
      takeProfitPx,
    });
    if (issue) {
      throw new Error(PROTECTION_SIDE_MESSAGES[issue]);
    }
  }

  const existingForCoin = existingOrders.filter(
    (order) => order.coin === marketName && order.isTrigger && order.reduceOnly,
  );
  // First match only. Several stops on one position is a deliberate strategy
  // (scaling out at different levels), and cancelling all of them because one
  // changed would silently undo it.
  const existingSl =
    existingForCoin.find(
      (order) =>
        classifyProtectionOrder(order, direction, referencePrice) === "stopLoss",
    ) ?? null;
  const existingTp =
    existingForCoin.find(
      (order) =>
        classifyProtectionOrder(order, direction, referencePrice) ===
        "takeProfit",
    ) ?? null;

  const cancelOids: number[] = [];
  const toPlace: ProtectionPlan["toPlace"] = [];

  if (stopLossPx !== (existingSl?.triggerPx ?? null)) {
    if (existingSl) cancelOids.push(existingSl.oid);
    if (stopLossPx != null) {
      toPlace.push({ triggerPx: stopLossPx, triggerKind: "stopLoss" });
    }
  }

  if (takeProfitPx !== (existingTp?.triggerPx ?? null)) {
    if (existingTp) cancelOids.push(existingTp.oid);
    if (takeProfitPx != null) {
      toPlace.push({ triggerPx: takeProfitPx, triggerKind: "takeProfit" });
    }
  }

  if (cancelOids.length === 0 && toPlace.length === 0) {
    throw new Error("No protection changes to apply.");
  }

  return { direction, side, size, cancelOids, toPlace };
}
