import { useEffect, useMemo, useRef, useState } from 'react';
import { getMarketBaseAsset, getMarketDisplayName, getMarketSearchTerms } from '@repo/hyperliquid-sdk';
import type { EnrichedMarket, MarketStats } from '@repo/types';
import { formatPrice } from '../utils/format';
import { MarketListItem } from './MarketListItem';

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

interface AllMarketsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  markets: EnrichedMarket[];
  mids: Record<string, string> | undefined;
  marketStats: Record<string, MarketStats> | undefined;
  onSelect: (coin: string) => void;
}

export function AllMarketsSheet({ isOpen, onClose, markets, mids, marketStats, onSelect }: AllMarketsSheetProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return markets;
    const normalizedQuery = query.toLowerCase();
    return markets.filter(({ market }) =>
      getMarketSearchTerms(market).some((term) => term.toLowerCase().includes(normalizedQuery)),
    );
  }, [markets, query]);

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
        aria-label="Close all markets"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-markets-title"
        className="relative mt-auto max-h-[92vh] flex flex-col rounded-t-2xl bg-white animate-slide-up overscroll-contain"
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <div className="flex-shrink-0 px-4 pt-2 pb-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="all-markets-title" className="text-base font-bold text-foreground">All Markets</h2>
            <span className="text-xs font-medium text-gray-400">{markets.length} markets</span>
          </div>

          <label htmlFor="all-markets-search-input" className="sr-only">Search all markets</label>
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
              id="all-markets-search-input"
              ref={inputRef}
              type="text"
              value={query}
              name="all-markets-search"
              autoComplete="off"
              placeholder="Search markets…"
              onChange={(event) => setQuery(event.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground placeholder-gray-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-full"
                aria-label="Clear all markets search"
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
            <div className="py-12 text-center text-sm text-gray-400">No markets found</div>
          ) : (
            filtered.map(({ market }) => {
              const coin = market.name;
              const displayName = getMarketDisplayName(market);
              const iconCoin = getMarketBaseAsset(market);
              const price = mids?.[coin] ? parseFloat(mids[coin]) : null;
              const stats = marketStats?.[coin];

              return (
                <MarketListItem
                  key={coin}
                  coin={coin}
                  displayName={displayName}
                  iconCoin={iconCoin}
                  marketType={market.type}
                  price={price != null ? formatPrice(price) : '\u2014'}
                  change24h={stats?.change24h ?? 0}
                  volume={stats ? formatVolume(stats.dayNtlVlm) : undefined}
                  maxLeverage={market.type === 'perp' ? market.maxLeverage : undefined}
                  onClick={() => onSelect(coin)}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
