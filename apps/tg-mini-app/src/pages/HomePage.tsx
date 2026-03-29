import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMarketData,
  useMids,
  useMarketStats,
  enrichMarkets,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket } from '@repo/types';
import { BalanceHero } from '../components/BalanceHero';
import { CategoryPills } from '../components/CategoryPills';
import { MarketListItem } from '../components/MarketListItem';
import { SearchSheet } from '../components/SearchSheet';

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
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: marketStats } = useMarketStats();

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
    if (selectedCategory === 'all') return enriched;
    return enriched.filter(({ categories }) => categories.includes(selectedCategory as any));
  }, [enriched, selectedCategory]);

  return (
    <div className="min-h-full bg-background">
      {/* Balance hero */}
      <BalanceHero />

      {/* Category pills */}
      <div className="px-4 mb-3">
        <CategoryPills
          categories={CATEGORY_ORDER}
          labels={CATEGORY_LABELS}
          selected={selectedCategory}
          onChange={setSelectedCategory}
        />
      </div>

      {/* Market list */}
      <div className="bg-white border-t border-separator">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No markets</div>
        ) : (
          <div className="divide-y divide-separator">
            {filtered.map(({ market }) => {
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
                  onClick={() => navigate(`/coin/${encodeURIComponent(coin)}`)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Floating search button */}
      <button
        onClick={() => setSearchOpen(true)}
        className="fixed bottom-24 right-4 w-12 h-12 bg-primary text-white rounded-full shadow-lg flex items-center justify-center z-40 active:bg-primary-dark transition-colors"
        aria-label="Search markets"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>
      </button>

      {/* Search sheet */}
      <SearchSheet
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(coin) => navigate(`/coin/${encodeURIComponent(coin)}`)}
      />
    </div>
  );
}
