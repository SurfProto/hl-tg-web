export type HomeMarketViewState = "loading" | "error" | "empty" | "ready";

export function getHomeMarketViewState({
  marketsLoading,
  marketsError,
  marketCount,
}: {
  marketsLoading: boolean;
  marketsError: boolean;
  marketCount: number;
}): HomeMarketViewState {
  if (marketsLoading) {
    return "loading";
  }

  if (marketsError) {
    return "error";
  }

  if (marketCount === 0) {
    return "empty";
  }

  return "ready";
}
