import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getMarketBaseAsset,
  getMarketDisplayName,
  useAssetCtx,
  useCandles,
  useMarketData,
  useMids,
  useSpotBalance,
} from "@repo/hyperliquid-sdk";
import type { AnyMarket } from "@repo/types";
import { Chart } from "@repo/ui";
import { StatRow } from "../components/StatRow";
import { TokenIcon } from "../components/TokenIcon";

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(4)}`;
  }
  return `$${price.toFixed(6)}`;
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(2)}K`;
  return `$${vol.toFixed(2)}`;
}

function formatFunding(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

export function CoinDetailPage() {
  const { symbol: rawSymbol = "" } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(rawSymbol);
  const navigate = useNavigate();

  const [interval, setInterval] = useState("1h");

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: assetCtx } = useAssetCtx(symbol);
  const { data: candles } = useCandles(symbol, interval);
  const { data: spotBalance } = useSpotBalance();

  const isPerp = useMemo(
    () =>
      markets?.perp?.some(
        (market: { name: string }) => market.name === symbol,
      ) ?? false,
    [markets, symbol],
  );

  const selectedMarket = useMemo<AnyMarket | null>(() => {
    const spotMatch = (markets?.spot ?? []).find(
      (market: { name: string }) => market.name === symbol,
    );
    if (spotMatch) return { ...spotMatch, type: "spot" as const };
    const perpMatch = (markets?.perp ?? []).find(
      (market: { name: string }) => market.name === symbol,
    );
    return perpMatch ? { ...perpMatch, type: "perp" as const } : null;
  }, [markets, symbol]);

  const displayName = selectedMarket
    ? getMarketDisplayName(selectedMarket)
    : getMarketDisplayName(symbol);
  const baseToken = selectedMarket
    ? getMarketBaseAsset(selectedMarket)
    : getMarketBaseAsset(symbol);
  const price = mids?.[symbol] ? parseFloat(mids[symbol]) : null;
  const change24h = assetCtx?.change24h ?? 0;
  const isPositive = change24h >= 0;

  const holdings = useMemo(() => {
    if (!spotBalance?.balances || isPerp) return null;
    const balance = (
      spotBalance.balances as Array<{ coin: string; total: string }>
    ).find((entry) => entry.coin === baseToken || entry.coin === displayName);
    return balance ? parseFloat(balance.total) : 0;
  }, [spotBalance, baseToken, displayName, isPerp]);

  return (
    <div className="min-h-full bg-background page-above-bottom-dock">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <div className="rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-black/[0.04]">
          <TokenIcon coin={baseToken} size={36} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-foreground">
            {displayName}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {isPerp ? "PERP" : "SPOT"}
          </span>
        </div>
      </div>

      <div className="px-4 pb-5">
        <div className="text-[2.35rem] font-bold tracking-tight text-foreground tabular-nums">
          {price != null ? formatPrice(price) : "\u2014"}
        </div>
        <div
          className={`mt-2 text-sm font-semibold ${isPositive ? "text-positive" : "text-negative"}`}
        >
          {isPositive ? "+" : ""}
          {change24h.toFixed(2)}%
          <span className="ml-1 font-medium text-gray-400">past day</span>
        </div>
      </div>

      <div className="px-4 pb-5">
        <Chart
          candles={candles ?? []}
          interval={interval}
          onIntervalChange={setInterval}
          currentPrice={price ?? undefined}
          variant="lite-candles"
          showLastPrice={true}
          zoomPreset="interval-default"
          ranges={[
            { key: "15m", label: "15M" },
            { key: "1h", label: "1H" },
            { key: "4h", label: "4H" },
            { key: "1d", label: "24H" },
          ]}
          showFooterStats={false}
          heightClassName="h-[248px]"
        />
      </div>

      <div className="px-4 pb-4">
        <div className="overflow-hidden rounded-[24px] border border-black/[0.05] bg-white/90 px-5 py-2 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
          {isPerp ? (
            <>
              <StatRow
                label="24h Change"
                value={`${isPositive ? "+" : ""}${change24h.toFixed(2)}%`}
                valueColor={isPositive ? "positive" : "negative"}
              />
              <StatRow
                label="24h Volume"
                value={assetCtx ? formatVolume(assetCtx.dayNtlVlm) : "\u2014"}
              />
              <StatRow
                label="Open Interest"
                value={
                  assetCtx && price
                    ? formatVolume(assetCtx.openInterest * price)
                    : "\u2014"
                }
              />
              <StatRow
                label="Funding Rate"
                value={assetCtx ? formatFunding(assetCtx.funding) : "\u2014"}
              />
            </>
          ) : (
            <>
              <StatRow
                label="Holdings"
                value={
                  holdings != null
                    ? `${holdings.toFixed(4)} ${baseToken}`
                    : "\u2014"
                }
              />
              <StatRow
                label="Holdings Value"
                value={
                  holdings != null && price != null
                    ? formatVolume(holdings * price)
                    : "\u2014"
                }
              />
              <StatRow label="Market Cap" value="$0" />
              <StatRow
                label="24h Volume"
                value={assetCtx ? formatVolume(assetCtx.dayNtlVlm) : "\u2014"}
              />
            </>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-separator px-4 py-3 bottom-dock-safe flex gap-3">
        {isPerp ? (
          <>
            <button
              type="button"
              onClick={() =>
                navigate(`/trade/${encodeURIComponent(symbol)}?side=short`)
              }
              className="flex-1 rounded-full bg-[#111827] py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(17,24,39,0.18)] transition-opacity active:opacity-80"
            >
              {"Short \u2193"}
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(`/trade/${encodeURIComponent(symbol)}?side=long`)
              }
              className="flex-1 rounded-full bg-primary py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)] transition-opacity active:opacity-80"
            >
              {"Long \u2191"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                navigate(`/trade/${encodeURIComponent(symbol)}?side=sell`)
              }
              className="flex-1 rounded-full bg-[#111827] py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(17,24,39,0.18)] transition-opacity active:opacity-80"
            >
              Sell
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(`/trade/${encodeURIComponent(symbol)}?side=buy`)
              }
              className="flex-1 rounded-full bg-primary py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)] transition-opacity active:opacity-80"
            >
              Buy
            </button>
          </>
        )}
      </div>
    </div>
  );
}
