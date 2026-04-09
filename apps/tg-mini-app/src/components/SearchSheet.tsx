import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  enrichMarkets,
  getMarketBaseAsset,
  getMarketDisplayName,
  getMarketSearchTerms,
  useMarketData,
  useMarketStats,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket } from '@repo/types';
import { getAsyncValueState } from '../lib/async-value-state';
import { formatPrice } from '../utils/format';
import { MarketListItem } from './MarketListItem';

interface SearchSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (coin: string) => void;
}

export function SearchSheet({ isOpen, onClose, onSelect }: SearchSheetProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  const { data: markets } = useMarketData();
  const { data: marketStats, isError: marketStatsError } = useMarketStats();

  const allMarkets: AnyMarket[] = useMemo(() => [
    // Spot disabled — perps only
    ...(markets?.perp ?? []).map((market: any) => ({ ...market, type: 'perp' as const })),
  ], [markets]);

  const priceChanges: Record<string, number> = useMemo(() => {
    if (!marketStats) return {};
    return Object.fromEntries(
      Object.entries(marketStats).map(([coin, stats]) => [coin, stats.change24h]),
    );
  }, [marketStats]);

  const enriched = useMemo(
    () => enrichMarkets(allMarkets, priceChanges, markets?.spotTokenNames),
    [allMarkets, priceChanges, markets?.spotTokenNames],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return enriched.slice(0, 50);
    const normalizedQuery = query.toLowerCase();
    return enriched
      .filter(({ market }) => getMarketSearchTerms(market).some((term) => term.toLowerCase().includes(normalizedQuery)))
      .slice(0, 50);
  }, [enriched, query]);

  useEffect(() => {
    if (!isOpen) return;

    setQuery('');
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label={t('search.ariaClose')}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-search-title"
        className="relative mt-auto max-h-[85vh] flex flex-col rounded-t-2xl bg-white animate-slide-up overscroll-contain"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <div className="px-4 py-3">
          <h2 id="market-search-title" className="sr-only">{t('search.title')}</h2>
          <label htmlFor="market-search-input" className="sr-only">{t('search.title')}</label>
          <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary/30">
            <svg
              className="h-4 w-4 flex-shrink-0 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <input
              id="market-search-input"
              ref={inputRef}
              type="text"
              value={query}
              name="market-search"
              autoComplete="off"
              placeholder={t('search.placeholder')}
              onChange={(event) => setQuery(event.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground placeholder-gray-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-full"
                aria-label={t('search.ariaClear')}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 divide-y divide-separator overflow-y-auto overscroll-contain">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">{t('search.noMarketsFound')}</div>
          ) : (
            filtered.map(({ market }) => {
              const coin = market.name;
              const displayName = getMarketDisplayName(market);
              const iconCoin = getMarketBaseAsset(market);
              const stats = marketStats?.[coin];
              const hasPrice =
                typeof stats?.markPx === 'number' && Number.isFinite(stats.markPx) && stats.markPx > 0;
              const priceState = getAsyncValueState({
                hasValue: hasPrice,
                isLoading: !marketStats && !marketStatsError,
                isError: marketStatsError || (!!marketStats && !hasPrice),
              });

              return (
                <MarketListItem
                  key={coin}
                  coin={coin}
                  displayName={displayName}
                  iconCoin={iconCoin}
                  marketType={market.type}
                  price={hasPrice ? formatPrice(stats!.markPx) : ''}
                  priceState={priceState}
                  change24h={priceState === 'ready' ? stats?.change24h ?? 0 : null}
                  maxLeverage={market.type === 'perp' ? market.maxLeverage : undefined}
                  onClick={() => {
                    onSelect(coin);
                    onClose();
                  }}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
