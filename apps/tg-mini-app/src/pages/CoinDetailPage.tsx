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

function formatPriceParts(price: number): { integer: string; decimal: string } {
  if (price >= 1000) {
    const formatted = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const parts = formatted.split('.');
    return { integer: parts[0] || '0', decimal: parts[1] || '00' };
  }
  if (price >= 1) {
    const formatted = price.toFixed(4);
    const parts = formatted.split('.');
    return { integer: parts[0] || '0', decimal: parts[1] || '0000' };
  }
  const formatted = price.toFixed(6);
  const parts = formatted.split('.');
  return { integer: parts[0] || '0', decimal: parts[1] || '000000' };
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(2)}K`;
  return `$${vol.toFixed(2)}`;
}

function formatFunding(rate: number): string {
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`;
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

  const priceParts = price != null ? formatPriceParts(price) : { integer: '0', decimal: '00' };
  const maxLeverage = selectedMarket?.type === 'perp' ? selectedMarket.maxLeverage : null;

  return (
    <div className="min-h-full bg-background page-above-bottom-dock">
      {/* Header with token info */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <TokenIcon coin={baseToken} size={40} />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {displayName}
            </span>
            <button
              type="button"
              className="p-1 text-muted"
              aria-label="Favorite"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted uppercase tracking-wide">
              {isPerp ? t('coinDetail.perpLabel') : t('coinDetail.spot')}
            </span>
            {maxLeverage && (
              <>
                <span className="text-muted">·</span>
                <span className="text-xs text-muted">{maxLeverage}x MAX</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Price display */}
      <div className="px-4 pb-4">
        {priceState === 'ready' ? (
          <>
            <div className="flex items-baseline gap-0.5">
              <span className="text-[2.75rem] font-bold tracking-tight text-foreground font-mono">
                ${priceParts.integer}
              </span>
              <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
                .{priceParts.decimal}
              </span>
            </div>
            <div className={`mt-1 flex items-center gap-2 text-sm font-medium ${isPositive ? 'text-positive' : 'text-negative'}`}>
              <svg className={`w-4 h-4 ${isPositive ? '' : 'rotate-180'}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className="font-mono">{isPositive ? '+' : ''}{change24h.toFixed(2)}%</span>
              <span className="text-muted font-normal">24h</span>
            </div>
          </>
        ) : priceState === 'loading' ? (
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
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

      {/* Chart */}
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
              { key: '15m', label: '15m' },
              { key: '1h', label: '1H' },
              { key: '4h', label: '4H' },
              { key: '1d', label: '1D' },
              { key: '1w', label: '1W' },
            ]}
            showFooterStats={false}
            heightClassName="h-[248px]"
          />

          {inspectionTooltip && (
            <div
              className="pointer-events-none absolute z-20 w-[184px] -translate-x-1/2 -translate-y-full rounded-2xl border border-separator bg-white px-3.5 py-3 shadow-lg"
              style={{
                left: `${inspectionTooltip.left}px`,
                top: `${inspectionTooltip.top}px`,
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                {formatTooltipTimestamp(inspectionTooltip.candle, interval)}
              </div>
              <div className="mt-1 text-lg font-bold tracking-tight text-foreground font-mono tabular-nums">
                {formatPrice(inspectionTooltip.candle.c)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-medium tabular-nums">
                <div className="flex items-center justify-between gap-2 text-muted">
                  <span>{t('coinDetail.open')}</span>
                  <span className="text-foreground font-mono">{formatPrice(inspectionTooltip.candle.o)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted">
                  <span>{t('coinDetail.high')}</span>
                  <span className="text-positive font-mono">{formatPrice(inspectionTooltip.candle.h)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted">
                  <span>{t('coinDetail.low')}</span>
                  <span className="text-negative font-mono">{formatPrice(inspectionTooltip.candle.l)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted">
                  <span>{t('coinDetail.vol')}</span>
                  <span className="text-foreground font-mono">{formatVolume(inspectionTooltip.candle.v)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats Card */}
      <div className="px-4 pb-4">
        <div className="overflow-hidden rounded-2xl border border-separator bg-white px-4 py-1">
          {isPerp ? (
            <>
              <StatRow
                label={t('coinDetail.volume24h')}
                value={
                  statsState === 'ready'
                    ? formatVolume(assetCtx!.dayNtlVlm)
                    : statsState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
                mono
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
                mono
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
                valueColor={assetCtx?.funding && assetCtx.funding >= 0 ? 'positive' : 'negative'}
                mono
              />
              <StatRow
                label={t('coinDetail.markPrice')}
                value={priceState === 'ready' ? formatPrice(price!) : t('common.loading')}
                mono
                noBorder
              />
            </>
          ) : (
            <>
              <StatRow
                label={t('coinDetail.holdings')}
                value={holdings != null ? `${holdings.toFixed(4)} ${baseToken}` : '\u2014'}
                mono
              />
              <StatRow
                label={t('coinDetail.holdingsValue')}
                value={holdings != null && priceState === 'ready' ? formatVolume(holdings * price!) : '\u2014'}
                mono
              />
              <StatRow label={t('coinDetail.marketCap')} value="$0" mono />
              <StatRow
                label={t('coinDetail.volume24h')}
                value={
                  statsState === 'ready'
                    ? formatVolume(assetCtx!.dayNtlVlm)
                    : statsState === 'loading'
                      ? t('common.loading')
                      : t('coinDetail.marketStatsUnavailable')
                }
                mono
                noBorder
              />
            </>
          )}
        </div>
      </div>

      {/* Bottom Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 flex gap-3 border-t border-separator bg-white px-4 py-3 bottom-dock-safe">
        {isPerp ? (
          <>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=short`)}
              className="flex-1 rounded-full border-2 border-negative py-3.5 font-semibold text-negative transition-colors active:bg-red-50"
            >
              {t('coinDetail.shortButton')} ↓
            </button>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=long`)}
              className="flex-1 rounded-full bg-primary py-3.5 font-semibold text-white shadow-[0_8px_20px_rgba(0,192,118,0.25)] transition-opacity active:opacity-80"
            >
              {t('coinDetail.longButton')} ↑
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=sell`)}
              className="flex-1 rounded-full border-2 border-secondary py-3.5 font-semibold text-secondary transition-colors active:bg-gray-50"
            >
              {t('coinDetail.sellButton')}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=buy`)}
              className="flex-1 rounded-full bg-primary py-3.5 font-semibold text-white shadow-[0_8px_20px_rgba(0,192,118,0.25)] transition-opacity active:opacity-80"
            >
              {t('coinDetail.buyButton')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
