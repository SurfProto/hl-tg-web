import type { MarketStats } from "@repo/types";
import { formatPrice } from "../utils/format";

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export function getHomeMarketDisplayState({
  stats,
  marketStatsFailed,
}: {
  stats: MarketStats | undefined;
  marketStatsFailed: boolean;
}): {
  dataState: "loading" | "error" | "ready";
  price: string | null;
  change24h: number | null;
  volume: string | null;
} {
  if (stats) {
    return {
      dataState: "ready",
      price: formatPrice(stats.markPx),
      change24h: stats.change24h,
      volume: formatVolume(stats.dayNtlVlm),
    };
  }

  if (marketStatsFailed) {
    return {
      dataState: "error",
      price: null,
      change24h: null,
      volume: null,
    };
  }

  return {
    dataState: "loading",
    price: null,
    change24h: null,
    volume: null,
  };
}
