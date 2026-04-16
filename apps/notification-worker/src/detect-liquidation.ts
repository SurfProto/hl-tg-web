import type {
  EligibleUser,
  PositionSnapshot,
  QueuedNotificationEvent,
} from "./types";

const LIQUIDATION_BANDS = [10, 5, 3] as const;

interface LiquidationRiskState {
  initialized: boolean;
  activeBandsByPosition: Record<string, number[]>;
}

interface DetectLiquidationEventsArgs {
  user: EligibleUser;
  positions: PositionSnapshot[];
  midsByCoin: Record<string, number>;
  state: LiquidationRiskState | null;
  enabled: boolean;
}

interface DetectLiquidationEventsResult {
  events: QueuedNotificationEvent[];
  state: LiquidationRiskState;
}

function getPositionKey(position: PositionSnapshot): string {
  return `${position.coin}|${position.szi >= 0 ? "long" : "short"}`;
}

function getDistancePercent(markPx: number, liquidationPx: number): number {
  return (Math.abs(markPx - liquidationPx) / markPx) * 100;
}

export function detectLiquidationEvents({
  user,
  positions,
  midsByCoin,
  state,
  enabled,
}: DetectLiquidationEventsArgs): DetectLiquidationEventsResult {
  const nextActiveBandsByPosition: Record<string, number[]> = {};
  const events: QueuedNotificationEvent[] = [];

  for (const position of positions) {
    if (!position.liquidationPx || position.szi === 0) {
      continue;
    }

    const markPx = midsByCoin[position.coin];
    if (!markPx || markPx <= 0) {
      continue;
    }

    const positionKey = getPositionKey(position);
    const currentBands = LIQUIDATION_BANDS.filter(
      (band) => getDistancePercent(markPx, position.liquidationPx!) <= band,
    );
    nextActiveBandsByPosition[positionKey] = [...currentBands];

    if (!state?.initialized || !enabled) {
      continue;
    }

    const previousBands = new Set(state.activeBandsByPosition[positionKey] ?? []);
    const newlyCrossedBands = currentBands.filter((band) => !previousBands.has(band));
    if (newlyCrossedBands.length === 0) {
      continue;
    }

    const band = Math.min(...newlyCrossedBands);
    events.push({
      userId: user.userId,
      channel: "telegram",
      topic: "liquidation_risk",
      idempotencyKey: `liquidation_risk:${user.walletAddress}:${positionKey}:${band}`,
      language: user.language,
      payload: {
        band,
        coin: position.coin,
        side: position.szi >= 0 ? "long" : "short",
        markPx,
        liquidationPx: position.liquidationPx,
        distancePercent: getDistancePercent(markPx, position.liquidationPx),
        size: Math.abs(position.szi),
        language: user.language,
      },
    });
  }

  return {
    events,
    state: {
      initialized: true,
      activeBandsByPosition: nextActiveBandsByPosition,
    },
  };
}
