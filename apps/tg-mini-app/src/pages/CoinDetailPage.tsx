import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useMarketData,
  useMids,
  useAssetCtx,
  useCandles,
  useSpotBalance,
  getMarketBaseAsset,
  getMarketDisplayName,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket } from '@repo/types';
import { Chart } from '@repo/ui';
import { TokenIcon } from '../components/TokenIcon';
import { StatRow } from '../components/StatRow';

function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
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
  const { symbol: rawSymbol = '' } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(rawSymbol);
  const navigate = useNavigate();

  const [interval, setInterval] = useState('1h');

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: assetCtx } = useAssetCtx(symbol);
  const { data: candles } = useCandles(symbol, interval);
  const { data: spotBalance } = useSpotBalance();

  const isPerp = useMemo(
    () => markets?.perp?.some((m: { name: string }) => m.name === symbol) ?? false,
    [markets, symbol],
  );

  const selectedMarket = useMemo<AnyMarket | null>(() => {
    const spotMatch = (markets?.spot ?? []).find((market: { name: string }) => market.name === symbol);
    if (spotMatch) return { ...spotMatch, type: 'spot' as const };
    const perpMatch = (markets?.perp ?? []).find((market: { name: string }) => market.name === symbol);
    return perpMatch ? { ...perpMatch, type: 'perp' as const } : null;
  }, [markets, symbol]);

  const displayName = selectedMarket ? getMarketDisplayName(selectedMarket) : getMarketDisplayName(symbol);
  const baseToken = selectedMarket ? getMarketBaseAsset(selectedMarket) : getMarketBaseAsset(symbol);

  const price = mids?.[symbol] ? parseFloat(mids[symbol]) : null;
  const change24h = assetCtx?.change24h ?? 0;
  const isPositive = change24h >= 0;

  // Spot holdings
  const holdings = useMemo(() => {
    if (!spotBalance?.balances || isPerp) return null;
    const b = (spotBalance.balances as Array<{ coin: string; total: string }>)
      .find(entry => entry.coin === baseToken || entry.coin === displayName);
    return b ? parseFloat(b.total) : 0;
  }, [spotBalance, baseToken, displayName, isPerp]);

  return (
    <div className="min-h-full bg-background pb-24">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <TokenIcon coin={baseToken} size={40} />
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground">{displayName}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
            {isPerp ? 'PERP' : 'SPOT'}
          </span>
        </div>
      </div>

      {/* Price + 24h change */}
      <div className="px-4 pb-4">
        <div className="text-3xl font-bold text-foreground tabular-nums">
          {price != null ? formatPrice(price) : '—'}
        </div>
        <div className={`text-sm font-medium mt-1 ${isPositive ? 'text-positive' : 'text-negative'}`}>
          {isPositive ? '+' : ''}{change24h.toFixed(2)}%
        </div>
      </div>

      {/* Chart with built-in interval picker */}
      <div className="px-4 pb-4">
        <Chart
          candles={candles ?? []}
          interval={interval}
          onIntervalChange={setInterval}
        />
      </div>

      {/* Stats */}
      <div className="px-4 pb-4">
        <div className="bg-white rounded-xl border border-separator overflow-hidden">
          {isPerp ? (
            <>
              <StatRow
                label="24h Change"
                value={`${isPositive ? '+' : ''}${change24h.toFixed(2)}%`}
                valueColor={isPositive ? 'positive' : 'negative'}
              />
              <StatRow
                label="24h Volume"
                value={assetCtx ? formatVolume(assetCtx.dayNtlVlm) : '—'}
              />
              <StatRow
                label="Open Interest"
                value={assetCtx && price ? formatVolume(assetCtx.openInterest * price) : '—'}
              />
              <StatRow
                label="Funding Rate"
                value={assetCtx ? formatFunding(assetCtx.funding) : '—'}
              />
            </>
          ) : (
            <>
              <StatRow
                label="Holdings"
                value={holdings != null ? `${holdings.toFixed(4)} ${baseToken}` : '—'}
              />
              <StatRow
                label="Holdings Value"
                value={holdings != null && price != null ? formatVolume(holdings * price) : '—'}
              />
              <StatRow label="Market Cap" value="$0" />
              <StatRow
                label="24h Volume"
                value={assetCtx ? formatVolume(assetCtx.dayNtlVlm) : '—'}
              />
            </>
          )}
        </div>
      </div>

      {/* Fixed bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-separator px-4 py-3 flex gap-3">
        {isPerp ? (
          <>
            <button
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=short`)}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-[#111827] active:opacity-80 transition-opacity"
            >
              Short ↓
            </button>
            <button
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=long`)}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-primary active:opacity-80 transition-opacity"
            >
              Long ↑
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=sell`)}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-[#111827] active:opacity-80 transition-opacity"
            >
              Sell
            </button>
            <button
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=buy`)}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-primary active:opacity-80 transition-opacity"
            >
              Buy
            </button>
          </>
        )}
      </div>
    </div>
  );
}
