import type { OpenOrder } from "@repo/types";

export type PositionDirection = "long" | "short";
export type ProtectionKind = "stopLoss" | "takeProfit";

export interface ProtectionDraft {
  stopLossEnabled: boolean;
  stopLossPx: string;
  takeProfitEnabled: boolean;
  takeProfitPx: string;
}

export interface ProtectionState {
  stopLoss: OpenOrder | null;
  takeProfit: OpenOrder | null;
  needsReview: boolean;
}

export const EMPTY_PROTECTION_DRAFT: ProtectionDraft = {
  stopLossEnabled: false,
  stopLossPx: "",
  takeProfitEnabled: false,
  takeProfitPx: "",
};

function nearlyEqual(
  left: number,
  right: number,
  tolerance: number = 1e-8,
): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function createProtectionDraft(
  stopLossPx?: number | null,
  takeProfitPx?: number | null,
): ProtectionDraft {
  return {
    stopLossEnabled: stopLossPx != null,
    stopLossPx: stopLossPx != null ? String(stopLossPx) : "",
    takeProfitEnabled: takeProfitPx != null,
    takeProfitPx: takeProfitPx != null ? String(takeProfitPx) : "",
  };
}

export function hasProtectionEnabled(draft: ProtectionDraft): boolean {
  return (
    (draft.stopLossEnabled && draft.stopLossPx.trim().length > 0) ||
    (draft.takeProfitEnabled && draft.takeProfitPx.trim().length > 0)
  );
}

export function parseProtectionPrice(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getProtectionPresetPrice(
  currentPrice: number,
  direction: PositionDirection,
  kind: ProtectionKind,
  percent: number,
): string {
  const normalizedPercent = Math.abs(percent) / 100;
  const multiplier =
    direction === "long"
      ? kind === "stopLoss"
        ? 1 - normalizedPercent
        : 1 + normalizedPercent
      : kind === "stopLoss"
        ? 1 + normalizedPercent
        : 1 - normalizedPercent;

  return (currentPrice * multiplier).toFixed(currentPrice >= 1 ? 2 : 6);
}

export function getProtectionPnl(
  triggerPx: number | null,
  entryPx: number | null,
  size: number,
  direction: PositionDirection,
): number | null {
  if (
    triggerPx == null ||
    entryPx == null ||
    !Number.isFinite(size) ||
    size <= 0
  ) {
    return null;
  }

  return direction === "long"
    ? (triggerPx - entryPx) * size
    : (entryPx - triggerPx) * size;
}

export function classifyProtectionOrder(
  order: OpenOrder,
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

export function getProtectionState(
  orders: OpenOrder[],
  direction: PositionDirection,
  currentPrice: number | null,
  positionSize: number,
): ProtectionState {
  let stopLoss: OpenOrder | null = null;
  let takeProfit: OpenOrder | null = null;

  for (const order of orders) {
    const kind = classifyProtectionOrder(order, direction, currentPrice);
    if (kind === "stopLoss" && stopLoss == null) {
      stopLoss = order;
    }
    if (kind === "takeProfit" && takeProfit == null) {
      takeProfit = order;
    }
  }

  const needsReview = [stopLoss, takeProfit].some(
    (order) =>
      order != null &&
      Number.isFinite(order.sz) &&
      !nearlyEqual(order.sz, Math.abs(positionSize)),
  );

  return {
    stopLoss,
    takeProfit,
    needsReview,
  };
}
