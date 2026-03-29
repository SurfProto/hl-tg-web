import { useEffect, useMemo, useRef, useState } from 'react';
import { useMarketData, useMids, useMarketStats, enrichMarkets } from '@repo/hyperliquid-sdk';
import type { AnyMarket } from '@repo/types';
import { MarketListItem } from './MarketListItem';

interface SearchSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (coin: string) => void;
}

export function SearchSheet({ isOpen, onClose, onSelect }: SearchSheetProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: marketStats } = useMarketStats();

  // Build AnyMarket[] matching the pattern used in TradePage
  const allMarkets: AnyMarket[] = useMemo(() => [
    ...(markets?.spot ?? []).map((m: any) => ({ ...m, type: 'spot' as const })),
    ...(markets?.perp ?? []).map((m: any) => ({ ...m, type: 'perp' as const })),
  ], [markets]);

  const priceChanges: Record<string, number> = useMemo(() => {
    if (!marketStats) return {};
    return Object.fromEntries(
      Object.entries(marketStats).map(([coin, stats]) => [coin, stats.change24h])
    );
  }, [marketStats]);

  const enriched = useMemo(
    () => enrichMarkets(allMarkets, priceChanges, markets?.spotTokenNames),
    [allMarkets, priceChanges, markets?.spotTokenNames],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return enriched.slice(0, 50);
    const q = query.toLowerCase();
    return enriched.filter(({ market }) =>
      market.name.toLowerCase().includes(q) ||
      (market.type === 'spot' && (market as any).baseName?.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [enriched, query]);

  // Auto-focus input when sheet opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Sheet panel */}
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[85vh] flex flex-col animate-slide-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Search input */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 bg-surface rounded-xl px-3 py-2.5">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder-gray-400 outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 divide-y divide-separator">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No markets found</div>
          ) : (
            filtered.map(({ market }) => {
              const coin = market.name;
              const displayCoin = coin.includes(':') ? coin.split(':')[1] : coin;
              const price = mids?.[coin] ? parseFloat(mids[coin]) : null;
              const stats = marketStats?.[coin];

              return (
                <MarketListItem
                  key={coin}
                  coin={coin}
                  marketType={market.type}
                  price={price != null ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : '—'}
                  change24h={stats?.change24h ?? 0}
                  maxLeverage={market.type === 'perp' ? market.maxLeverage : undefined}
                  isHip3={market.isHip3}
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
