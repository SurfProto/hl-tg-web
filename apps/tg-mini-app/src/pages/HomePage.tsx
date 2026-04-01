import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMarketData,
  useMids,
  useMarketStats,
  enrichMarkets,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  SUB_FILTERS,
  getMarketBaseAsset,
  getMarketDisplayName,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket, MarketCategory, MarketSubCategory } from '@repo/types';
import { formatPrice } from '../utils/format';
import { BalanceHero } from '../components/BalanceHero';
import { CategoryPills } from '../components/CategoryPills';
import { MarketListItem } from '../components/MarketListItem';
import { AllMarketsSheet } from '../components/AllMarketsSheet';
import { MarketListItemSkeleton } from '../components/MarketListItemSkeleton';
import { SearchSheet } from '../components/SearchSheet';

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSubCategory, setSelectedSubCategory] = useState<MarketSubCategory | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [allMarketsOpen, setAllMarketsOpen] = useState(false);

  const { data: markets, isLoading: marketsLoading } = useMarketData();
  const { data: mids, isLoading: midsLoading } = useMids();
  const { data: marketStats } = useMarketStats();
  const isLoading = marketsLoading || midsLoading;

  const subFilters = SUB_FILTERS[selectedCategory as MarketCategory] ?? null;

  useEffect(() => {
    setSelectedSubCategory(null);
  }, [selectedCategory]);

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
    let result = selectedCategory === 'all' ? enriched
      : enriched.filter(({ categories }) => categories.includes(selectedCategory as MarketCategory));
    if (selectedSubCategory) {
      result = result.filter(({ subCategory }) => subCategory === selectedSubCategory);
    }
    return result;
  }, [enriched, selectedCategory, selectedSubCategory]);

  return (
    <div className="min-h-full bg-background">
      {/* Balance hero */}
      <BalanceHero />

      {/* Category pills */}
      <div className="px-4 mb-2">
        <CategoryPills
          categories={CATEGORY_ORDER}
          labels={CATEGORY_LABELS}
          selected={selectedCategory}
          onChange={setSelectedCategory}
        />
      </div>

      {/* Sub-filter pills */}
      {subFilters && (
        <div className="px-4 mb-3 flex gap-2 overflow-x-auto no-scrollbar">
          <button
            onPointerDown={() => setSelectedSubCategory(null)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedSubCategory === null
                ? 'bg-foreground text-white'
                : 'bg-surface text-gray-500'
            }`}
          >
            All
          </button>
          {subFilters.map(({ key, label }) => (
            <button
              key={key}
              onPointerDown={() => setSelectedSubCategory(key)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedSubCategory === key
                  ? 'bg-foreground text-white'
                  : 'bg-surface text-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Market list */}
      <div className="bg-white border-t border-separator">
        {isLoading ? (
          <div className="divide-y divide-separator">
            {Array.from({ length: 6 }, (_, i) => <MarketListItemSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No markets</div>
        ) : (
          <div className="divide-y divide-separator">
            {filtered.slice(0, 6).map(({ market }) => {
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
                  price={price != null ? formatPrice(price) : '—'}
                  change24h={stats?.change24h ?? 0}
                  volume={stats ? formatVolume(stats.dayNtlVlm) : undefined}
                  maxLeverage={market.type === 'perp' ? market.maxLeverage : undefined}
                  onClick={() => navigate(`/coin/${encodeURIComponent(coin)}`)}
                />
              );
            })}
            {filtered.length > 6 && (
              <button
                onClick={() => setAllMarketsOpen(true)}
                className="w-full flex items-center justify-between px-4 py-3.5 bg-white active:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-medium text-primary">See all {filtered.length} markets</span>
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
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

      {/* All markets sheet */}
      <AllMarketsSheet
        isOpen={allMarketsOpen}
        onClose={() => setAllMarketsOpen(false)}
        markets={filtered}
        mids={mids}
        marketStats={marketStats}
        onSelect={(coin) => { setAllMarketsOpen(false); navigate(`/coin/${encodeURIComponent(coin)}`); }}
      />
    </div>
  );
}
