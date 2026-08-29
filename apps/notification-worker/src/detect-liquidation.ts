import type {
  EligibleUser,
  PositionSnapshot,
  QueuedNotificationEvent,
} from "./types";

const LIQUIDATION_BANDS = [10, 5, 3] as const;

export interface LiquidationRiskState {
  initialized: boolean;
  activeBandsByPosition: Record<string, number[]>;
  /**
   * When each position's current danger episode began — an episode running
   * from the first band crossed until the position leaves all bands or
   * closes. Part of the idempotency key so a later episode alerts again:
   * events are deduplicated against a permanently-unique column, and a key
   * without an episode made every band a once-per-lifetime alert. A user who
   * recovered, came back months later and drifted toward liquidation again
   * got silence.
   */
  episodeStartByPosition?: Record<string, string>;
}

interface DetectLiquidationEventsArgs {
  user: EligibleUser;
  positions: PositionSnapshot[];
  midsByCoin: Record<string, number>;
  state: LiquidationRiskState | null;
  enabled: boolean;
  /** The scan time, stamped onto any episode that begins this scan. */
  nowIso: string;
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
  nowIso,
}: DetectLiquidationEventsArgs): DetectLiquidationEventsResult {
  const nextActiveBandsByPosition: Record<string, number[]> = {};
  const nextEpisodeStartByPosition: Record<string, string> = {};
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

    const previousBands = new Set(
      state?.activeBandsByPosition[positionKey] ?? [],
    );

    // A new episode starts when a band-free position crosses its first band.
    // The missing-start fallback covers state written before episodes existed:
    // mid-episode positions adopt the scan time, which no stored key can
    // collide with.
    let episodeStartedAt = state?.episodeStartByPosition?.[positionKey];
    if (currentBands.length > 0) {
      if (!episodeStartedAt || previousBands.size === 0) {
        episodeStartedAt = nowIso;
      }
      nextEpisodeStartByPosition[positionKey] = episodeStartedAt;
    }

    if (!state?.initialized || !enabled) {
      continue;
    }

    const newlyCrossedBands = currentBands.filter((band) => !previousBands.has(band));
    if (newlyCrossedBands.length === 0) {
      continue;
    }

    const band = Math.min(...newlyCrossedBands);
    events.push({
      userId: user.userId,
      channel: "telegram",
      topic: "liquidation_risk",
      idempotencyKey: `liquidation_risk:${user.walletAddress}:${positionKey}:${band}:${episodeStartedAt}`,
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
      episodeStartByPosition: nextEpisodeStartByPosition,
    },
  };
}
