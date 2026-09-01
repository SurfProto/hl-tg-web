import { startTransition, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  getMarketBaseAsset,
  getMarketDisplayName,
  useAssetCtx,
  useCandles,
  useClosePosition,
  useMarketData,
  useMarketPrice,
  useSpotBalance,
  useUserState,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket, Candle } from '@repo/types';
import { Chart, type LiteCandleInspection } from '@repo/ui';
import { StatRow } from '../components/StatRow';
import {
  formatPercent,
  formatPnl,
  formatPositionSize,
  formatUsdPrice,
  formatUsdPriceParts,
} from '../utils/format';
import { getAsyncValueState } from '../lib/async-value-state';
import { findPositionForSymbol } from '../lib/market-symbol';
import { useHaptics } from '../hooks/useHaptics';
import { useToast } from '../hooks/useToast';
import { TokenIcon } from '../components/TokenIcon';

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(2)}K`;
  return `$${vol.toFixed(2)}`;
}

// Open interest is a quantity of the base asset. Rendering it as notional
// needs a price, and a missing price used to blank the field entirely even
// though the quantity itself was loaded — so fall back to base units.
function formatBaseUnits(units: number): string {
  if (units >= 1_000_000_000) return `${(units / 1_000_000_000).toFixed(2)}B`;
  if (units >= 1_000_000) return `${(units / 1_000_000).toFixed(2)}M`;
  if (units >= 1_000) return `${(units / 1_000).toFixed(2)}K`;
  return units.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatFunding(rate: number): string {
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`;
}

// Locale comes from i18n, like ApprovalsPage — this was hardcoded to en-US,
// so the Russian UI dated its chart tooltips in English.
function formatTooltipTimestamp(candle: Candle, interval: string, locale: string): string {
  const date = new Date(candle.T || candle.t);

  if (interval === '1d') {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);
  }

  return new Intl.DateTimeFormat(locale, {
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
  const { t, i18n } = useTranslation();
  const haptics = useHaptics();
  const toast = useToast();

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
  const { data: userState } = useUserState();
  const closePosition = useClosePosition();

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

  /**
   * The user's exposure to this market, if any.
   *
   * Matched on the whole symbol, dex prefix included: a position on `xyz:BTC`
   * belongs to a different market than plain `BTC` and must not appear here.
   * Perps only — spot holdings are the row above, and no position can carry a
   * spot pair's name.
   */
  const position = useMemo(
    () => (isPerp ? findPositionForSymbol(userState?.assetPositions, symbol) : null),
    [isPerp, userState?.assetPositions, symbol],
  );

  const handleClosePosition = () => {
    if (!position) return;

    haptics.medium();
    closePosition.mutate(position.coin, {
      onSuccess: () => {
        haptics.success();
        toast.success(t('positions.positionClosed', { name: displayName }));
      },
      onError: (error) => {
        haptics.error();
        toast.error(
          error instanceof Error ? error.message : t('positions.closeFailed'),
        );
      },
    });
  };

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

  const priceParts = price != null ? formatUsdPriceParts(price) : { integer: '0', decimal: '00' };
  const maxLeverage = selectedMarket?.type === 'perp' ? selectedMarket.maxLeverage : null;

  return (
    <div className="editorial-page page-above-bottom-dock">
      <div className="editorial-shell">
        <div className="relative flex items-start gap-3 overflow-hidden">
          <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 text-[3.25rem] font-extrabold tracking-[-0.08em] text-primary/[0.05]">
            {baseToken}
          </span>
          <TokenIcon coin={baseToken} size={40} />
          <div className="flex-1">
            <p className="editorial-kicker">
              {isPerp ? t('coinDetail.perpLabel') : t('coinDetail.spot')}
              {maxLeverage ? ` • ${maxLeverage}x MAX` : ''}
            </p>
            <div className="flex items-center gap-2">
              <span className="editorial-section-title text-foreground">
                {displayName}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-5">
          {priceState === 'ready' ? (
            <>
              <div className="flex items-baseline gap-0.5">
                <span className="editorial-display text-foreground">
                  ${priceParts.integer}
                </span>
                <span className="editorial-display-xs text-foreground">
                  .{priceParts.decimal}
                </span>
              </div>
              <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${isPositive ? 'p34k-signal' : 'bg-negative/10 text-negative'}`}>
                <svg className={`w-4 h-4 ${isPositive ? '' : 'rotate-180'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <span className="editorial-mono">{isPositive ? '+' : ''}{change24h.toFixed(2)}%</span>
                <span className="text-muted font-normal">24h</span>
              </div>
            </>
          ) : priceState === 'loading' ? (
            <div className="flex items-center gap-2 text-sm font-medium text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-separator border-t-primary" />
              {t('coinDetail.loadingMarketPrice')}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-warning">
                {t('coinDetail.marketPriceUnavailable')}
              </p>
              <button
                type="button"
                onClick={() => void refetchPrice()}
                className="editorial-button-ghost"
              >
                {t('common.retry')}
              </button>
            </div>
          )}
        </div>

        <div className="editorial-card-soft mt-5 p-2">
          <div className="relative rounded-[16px]">
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
                className="pointer-events-none absolute z-20 w-[184px] -translate-x-1/2 -translate-y-full rounded-[22px] border border-border bg-white px-3.5 py-3 shadow-lg"
                style={{
                  left: `${inspectionTooltip.left}px`,
                  top: `${inspectionTooltip.top}px`,
                }}
              >
                <div className="editorial-kicker">
                  {formatTooltipTimestamp(inspectionTooltip.candle, interval, i18n.language)}
                </div>
                <div className="editorial-mono mt-1 text-lg font-semibold tracking-tight text-foreground">
                  {formatUsdPrice(inspectionTooltip.candle.c)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-medium">
                  <div className="flex items-center justify-between gap-2 text-muted">
                    <span>{t('coinDetail.open')}</span>
                    <span className="editorial-mono text-foreground">{formatUsdPrice(inspectionTooltip.candle.o)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted">
                    <span>{t('coinDetail.high')}</span>
                    <span className="editorial-mono text-positive">{formatUsdPrice(inspectionTooltip.candle.h)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted">
                    <span>{t('coinDetail.low')}</span>
                    <span className="editorial-mono text-negative">{formatUsdPrice(inspectionTooltip.candle.l)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted">
                    <span>{t('coinDetail.vol')}</span>
                    <span className="editorial-mono text-foreground">{formatVolume(inspectionTooltip.candle.v)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* The trader's own exposure, on the screen where the decision is made.
            Absent a position there is nothing to say, so nothing is drawn — an
            empty card here would only push the market stats down. */}
        {position ? (
          <div className="mt-5">
            <p className="editorial-kicker pb-2">{t('coinDetail.yourPosition')}</p>
            <div className="editorial-card overflow-hidden px-4 py-1">
              <StatRow
                label={t('coinDetail.positionSide')}
                value={position.szi > 0 ? t('common.long') : t('common.short')}
                valueColor={position.szi > 0 ? 'positive' : 'negative'}
              />
              <StatRow
                label={t('coinDetail.positionSize')}
                value={`${formatPositionSize(Math.abs(position.szi))} ${baseToken}`}
                mono
              />
              <StatRow
                label={t('coinDetail.positionEntry')}
                value={formatUsdPrice(position.entryPx)}
                mono
              />
              <StatRow
                label={t('coinDetail.positionPnl')}
                value={`${formatPnl(position.unrealizedPnl ?? 0)} · ${formatPercent(
                  (position.returnOnEquity ?? 0) * 100,
                )}`}
                valueColor={(position.unrealizedPnl ?? 0) >= 0 ? 'positive' : 'negative'}
                mono
              />
              {/* Only the exchange's own liquidation price, never one this app
                  worked out: the in-house estimate is optimistic in the
                  direction that costs money, so an absent figure is omitted
                  rather than guessed at. */}
              {position.liquidationPx != null ? (
                <StatRow
                  label={t('coinDetail.positionLiquidation')}
                  value={formatUsdPrice(position.liquidationPx)}
                  mono
                />
              ) : null}
              <StatRow
                label={t('coinDetail.positionLeverage')}
                value={`${position.leverage?.value ?? 1}×`}
                mono
                noBorder
              />
            </div>
            <button
              type="button"
              onClick={handleClosePosition}
              disabled={closePosition.isPending}
              className="editorial-button-secondary mt-3 w-full disabled:opacity-50"
            >
              {closePosition.isPending
                ? t('common.closing')
                : t('coinDetail.closePosition')}
            </button>
          </div>
        ) : null}

        <div className="mt-5">
          <p className="editorial-kicker pb-2">{t('coinDetail.marketStats')}</p>
          <div className="editorial-card overflow-hidden px-4 py-1">
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
                      : statsState === 'ready'
                        ? `${formatBaseUnits(assetCtx!.openInterest)} ${baseToken}`
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
                  value={priceState === 'ready' ? formatUsdPrice(price!) : t('common.loading')}
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
      </div>

      {/* Trading is perps-only: TradePage resolves perp markets exclusively,
          so the Buy/Sell pair this dock rendered for spot symbols led straight
          to a dead "market metadata unavailable" screen. No dock for spot. */}
      {isPerp ? (
        <div className="fixed bottom-0 left-0 right-0 flex gap-3 border-t border-separator bg-white px-4 py-3 bottom-dock-safe">
          <button
            type="button"
            onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=short`)}
            className="editorial-button-negative flex-1"
          >
            {t('coinDetail.shortButton')}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/trade/${encodeURIComponent(symbol)}?side=long`)}
            className="editorial-button-positive flex-1"
          >
            {t('coinDetail.longButton')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
