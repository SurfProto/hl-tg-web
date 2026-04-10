import { startTransition, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  getMarketBaseAsset,
  getMarketDisplayName,
  useAssetCtx,
  useCandles,
  useMarketData,
  useMarketPrice,
  useSpotBalance,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket, Candle } from '@repo/types';
import { Chart, type LiteCandleInspection } from '@repo/ui';
import { StatRow } from '../components/StatRow';
import { getAsyncValueState } from '../lib/async-value-state';
import { TokenIcon } from '../components/TokenIcon';

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

function formatTooltipTimestamp(candle: Candle, interval: string): string {
  const date = new Date(candle.T || candle.t);

  if (interval === '1d') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function CoinDetailPage() {
  const { symbol: rawSymbol = '' } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(rawSymbol);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [interval, setInterval] = useState('1h');
  const [activeInspection, setActiveInspection] = useState<LiteCandleInspection | null>(null);

  const { data: markets } = useMarketData();
  const {
    data: price,
    isError: priceError,
    isLoading: priceLoading,
    refetch: refetchPrice,
  } = useMarketPrice(symbol);
  const {
    data: assetCtx,
    isError: assetCtxError,
    isLoading: assetCtxLoading,
  } = useAssetCtx(symbol);
  const { data: candles } = useCandles(symbol, interval);
  const { data: spotBalance } = useSpotBalance();

  const selectedMarket = useMemo<AnyMarket | null>(() => {
    const spotMatch = (markets?.spot ?? []).find((market: { name: string }) => market.name === symbol);
    if (spotMatch) {
      return { ...spotMatch, type: 'spot' as const };
    }

    const perpMatch = (markets?.perp ?? []).find((market: { name: string }) => market.name === symbol);
    return perpMatch ? { ...perpMatch, type: 'perp' as const } : null;
  }, [markets, symbol]);

  const isPerp = selectedMarket?.type !== 'spot';
  const displayName = selectedMarket
    ? getMarketDisplayName(selectedMarket)
    : getMarketDisplayName(symbol);
  const baseToken = selectedMarket
    ? getMarketBaseAsset(selectedMarket)
    : getMarketBaseAsset(symbol);
  const change24h = assetCtx?.change24h ?? 0;
  const isPositive = change24h >= 0;
  const priceState = getAsyncValueState({
    hasValue: price != null,
    isLoading: priceLoading,
    isError: priceError,
  });
  const statsState = getAsyncValueState({
    hasValue: assetCtx != null,
    isLoading: assetCtxLoading,
    isError: assetCtxError,
  });

  const holdings = useMemo(() => {
    if (!spotBalance?.balances || isPerp) return null;

    const balance = (spotBalance.balances as Array<{ coin: string; total: string }>)
      .find((entry) => entry.coin === baseToken || entry.coin === displayName);

    return balance ? parseFloat(balance.total) : 0;
  }, [spotBalance, baseToken, displayName, isPerp]);

  const inspectionTooltip = useMemo(() => {
    if (!activeInspection) return null;

    const tooltipWidth = 184;
    const horizontalPadding = 16;
    const halfWidth = tooltipWidth / 2;
    const maxLeft = Math.max(
      halfWidth + horizontalPadding,
      activeInspection.containerWidth - halfWidth - horizontalPadding,
    );
    const left = Math.min(
      maxLeft,
      Math.max(halfWidth + horizontalPadding, activeInspection.x),
    );
    const top = Math.min(
      activeInspection.containerHeight - 16,
      Math.max(88, activeInspection.y - 12),
    );

    return {
      candle: activeInspection.candle,
      left,
      top,
    };
  }, [activeInspection]);

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
            {isPerp ? t('coinDetail.perp') : t('coinDetail.spot')}
          </span>
        </div>
      </div>

      <div className="px-4 pb-5">
        {priceState === 'ready' ? (
          <>
            <div className="text-[2.35rem] font-bold tracking-tight text-foreground tabular-nums">
              {formatPrice(price!)}
            </div>
            <div className={`mt-2 text-sm font-semibold ${isPositive ? 'text-positive' : 'text-negative'}`}>
              {isPositive ? '+' : ''}
              {change24h.toFixed(2)}%
              <span className="ml-1 font-medium text-gray-400">{t('coinDetail.pastDay')}</span>
            </div>
          </>
        ) : priceState === 'loading' ? (
          <div className="flex items-center gap-2 text-sm font-medium text-gray-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
            {t('coinDetail.loadingMarketPrice')}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-amber-600">
              {t('coinDetail.marketPriceUnavailable')}
            </p>
            <button
              type="button"
              onClick={() => void refetchPrice()}
              className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition-colors active:bg-gray-100"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pb-5">
        <div className="relative">
          <Chart
            candles={candles ?? []}
            interval={interval}
            onIntervalChange={(nextInterval) => {
              setActiveInspection(null);
              setInterval(nextInterval);
            }}
            currentPrice={price ?? undefined}
            variant="lite-candles"
            showLastPrice={true}
            zoomPreset="interval-default"
            enableLiteCandleInspect={true}
            onLiteCandleInspect={(inspection) => {
              startTransition(() => {
                setActiveInspection(inspection);
              });
            }}
            ranges={[
              { key: '15m', label: '15M' },
              { key: '1h', label: '1H' },
              { key: '4h', label: '4H' },
              { key: '1d', label: '24H' },
            ]}
            showFooterStats={false}
            heightClassName="h-[248px]"
          />

          {inspectionTooltip && (
            <div
              className="pointer-events-none absolute z-20 w-[184px] -translate-x-1/2 -translate-y-full rounded-[22px] border border-white/75 bg-white/95 px-3.5 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm"
              style={{
                left: `${inspectionTooltip.left}px`,
                top: `${inspectionTooltip.top}px`,
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                {formatTooltipTimestamp(inspectionTooltip.candle, interval)}
              </div>
              <div className="mt-1 text-lg font-bold tracking-tight text-foreground tabular-nums">
                {formatPrice(inspectionTooltip.candle.c)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-medium tabular-nums">
                <div className="flex items-center justify-between gap-2 text-gray-500">
                  <span>{t('coinDetail.open')}</span>
                  <span className="text-foreground">{formatPrice(inspectionTooltip.candle.o)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-gray-500">
                  <span>{t('coinDetail.high')}</span>
                  <span className="text-positive">{formatPrice(inspectionTooltip.candle.h)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-gray-500">
                  <span>{t('coinDetail.low')}</span>
                  <span className="text-negative">{formatPrice(inspectionTooltip.candle.l)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-gray-500">
                  <span>{t('coinDetail.vol')}</span>
                  <span className="text-foreground">{formatVolume(inspectionTooltip.candle.v)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="overflow-hidden rounded-[24px] border border-black/[0.05] bg-white/90 px-5 py-2 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
          {isPerp ? (
            <>
              <StatRow
                label={t('coinDetail.change24h')}
                value={
                  statsState === 'ready'
                    ? `${isPositive ? '+' : ''}${change24h.toFixed(2)}%`
                    : statsState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
                valueColor={isPositive ? 'positive' : 'negative'}
              />
              <StatRow
                label={t('coinDetail.volume24h')}
                value={
                  statsState === 'ready'
                    ? formatVolume(assetCtx!.dayNtlVlm)
                    : statsState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
              />
              <StatRow
                label={t('coinDetail.openInterest')}
                value={
                  statsState === 'ready' && priceState === 'ready'
                    ? formatVolume(assetCtx!.openInterest * price!)
                    : statsState === 'loading' || priceState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
              />
              <StatRow
                label={t('coinDetail.fundingRate')}
                value={
                  statsState === 'ready'
                    ? formatFunding(assetCtx!.funding)
                    : statsState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
              />
            </>
          ) : (
            <>
              <StatRow
                label={t('coinDetail.holdings')}
                value={holdings != null ? `${holdings.toFixed(4)} ${baseToken}` : '\u2014'}
              />
              <StatRow
                label={t('coinDetail.holdingsValue')}
                value={holdings != null && priceState === 'ready' ? formatVolume(holdings * price!) : '\u2014'}
              />
              <StatRow label={t('coinDetail.marketCap')} value="$0" />
              <StatRow
                label={t('coinDetail.volume24h')}
                value={
                  statsState === 'ready'
                    ? formatVolume(assetCtx!.dayNtlVlm)
                    : statsState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
              />
            </>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 flex gap-3 border-t border-separator bg-white px-4 py-3 bottom-dock-safe">
        {isPerp ? (
          <>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=short`)}
              className="flex-1 rounded-full bg-[#111827] py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(17,24,39,0.18)] transition-opacity active:opacity-80"
            >
              {t('coinDetail.shortButton')}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=long`)}
              className="flex-1 rounded-full bg-primary py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)] transition-opacity active:opacity-80"
            >
              {t('coinDetail.longButton')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=sell`)}
              className="flex-1 rounded-full bg-[#111827] py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(17,24,39,0.18)] transition-opacity active:opacity-80"
            >
              {t('coinDetail.sellButton')}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=buy`)}
              className="flex-1 rounded-full bg-primary py-3.5 font-semibold text-white shadow-[0_12px_24px_rgba(59,130,246,0.2)] transition-opacity active:opacity-80"
            >
              {t('coinDetail.buyButton')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
