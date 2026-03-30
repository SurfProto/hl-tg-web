import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnrichedMarket, MarketStats } from '@repo/types';
import { MarketListItem } from './MarketListItem';

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
}

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
    const q = query.toLowerCase();
    return markets.filter(({ market }) =>
      market.name.toLowerCase().includes(q) ||
      (market.type === 'spot' && (market as any).baseName?.toLowerCase().includes(q))
    );
  }, [markets, query]);

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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet panel */}
      <div className="relative mt-auto bg-white rounded-t-2xl max-h-[92vh] flex flex-col animate-slide-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="px-4 pt-2 pb-1 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-foreground">All Markets</h2>
            <span className="text-xs text-gray-400 font-medium">{markets.length} markets</span>
          </div>

          {/* Search input */}
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
              const price = mids?.[coin] ? parseFloat(mids[coin]) : null;
              const stats = marketStats?.[coin];

              return (
                <MarketListItem
                  key={coin}
                  coin={coin}
                  marketType={market.type}
                  price={price != null ? formatPrice(price) : '—'}
                  change24h={stats?.change24h ?? 0}
                  volume={stats ? formatVolume(stats.dayNtlVlm) : undefined}
                  maxLeverage={market.type === 'perp' ? market.maxLeverage : undefined}
                  isHip3={market.isHip3}
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
