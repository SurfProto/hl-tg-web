import React, { useState, useMemo } from 'react';
import type { AnyMarket, EnrichedMarket, MarketCategory } from '@repo/types';

function getDisplayName(market: AnyMarket): string {
  if (market.type === 'spot') {
    const spot = market as any;
    return `${spot.baseName}/${spot.quoteName}`;
  }
  return market.name;
}

interface MarketSelectorProps {
  markets: EnrichedMarket[];
  selectedMarket: string;
  onSelectMarket: (market: string) => void;
  prices?: Record<string, string>;
  priceChanges?: Record<string, number>;
  categories?: MarketCategory[];
  categoryLabels?: Record<string, string>;
}

const DEFAULT_CATEGORIES: MarketCategory[] = [
  'all', 'perps', 'spot', 'crypto', 'tradfi', 'hip3', 'trending', 'prelaunch',
];

const DEFAULT_LABELS: Record<string, string> = {
  all: 'All',
  perps: 'Perps',
  spot: 'Spot',
  crypto: 'Crypto',
  tradfi: 'Tradfi',
  hip3: 'HIP-3',
  trending: 'Trending',
  prelaunch: 'Pre-launch',
};

export function MarketSelector({
  markets,
  selectedMarket,
  onSelectMarket,
  prices = {},
  priceChanges = {},
  categories = DEFAULT_CATEGORIES,
  categoryLabels = DEFAULT_LABELS,
}: MarketSelectorProps) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MarketCategory>('all');

  // Only show tabs that have at least one market
  const visibleTabs = useMemo(() => {
    return categories.filter(
      (cat) => cat === 'all' || markets.some((em) => em.categories.includes(cat))
    );
  }, [categories, markets]);

  const filteredMarkets = useMemo(() => {
    return markets
      .filter((em) => activeTab === 'all' || em.categories.includes(activeTab))
      .filter((em) => {
        const lower = search.toLowerCase();
        return em.market.name.toLowerCase().includes(lower) ||
          getDisplayName(em.market).toLowerCase().includes(lower);
      });
  }, [markets, activeTab, search]);

  const selectedEnriched = markets.find((em) => em.market.name === selectedMarket);
  const currentPrice = prices[selectedMarket];
  const currentChange = priceChanges[selectedMarket];

  const formatPrice = (price: string | undefined) => {
    if (!price) return '-';
    const num = parseFloat(price);
    if (num >= 1000) return num.toFixed(2);
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatChange = (change: number | undefined) => {
    if (change === undefined) return '';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${(change * 100).toFixed(2)}%`;
  };

  return (
    <div className="relative">
      {/* Selected Market Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center">
            <span className="text-sm font-bold">
              {selectedEnriched ? getDisplayName(selectedEnriched.market).slice(0, 2) : selectedMarket.slice(0, 2)}
            </span>
          </div>
          <div className="text-left">
            <div className="flex items-center space-x-2">
              <p className="font-semibold">{selectedEnriched ? getDisplayName(selectedEnriched.market) : selectedMarket}</p>
              {selectedEnriched && (
                <TagBadges tags={selectedEnriched.tags} maxLeverage={selectedEnriched.market.maxLeverage} />
              )}
            </div>
            <div className="flex items-center space-x-2 mt-0.5">
              <p className="text-sm text-gray-300">
                ${formatPrice(currentPrice)}
              </p>
              {currentChange !== undefined && (
                <p className={`text-xs ${currentChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatChange(currentChange)}
                </p>
              )}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-50 max-h-[28rem] overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-gray-800">
            <input
              type="text"
              placeholder="Search markets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          {/* Category Tabs */}
          <div className="flex overflow-x-auto px-3 py-2 gap-1.5 border-b border-gray-800 no-scrollbar">
            {visibleTabs.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === cat
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {categoryLabels[cat] ?? cat}
              </button>
            ))}
          </div>

          {/* Market List */}
          <div className="overflow-y-auto max-h-72">
            {filteredMarkets.length === 0 ? (
              <p className="text-center text-gray-500 py-4">No markets found</p>
            ) : (
              filteredMarkets.map((em) => {
                const { market } = em;
                const price = prices[market.name];
                const change = priceChanges[market.name];

                return (
                  <button
                    key={`${market.type}-${market.name}`}
                    onClick={() => {
                      onSelectMarket(market.name);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition-colors ${
                      market.name === selectedMarket ? 'bg-gray-800' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center">
                        <span className="text-xs font-bold">
                          {getDisplayName(market).slice(0, 2)}
                        </span>
                      </div>
                      <div className="text-left">
                        <div className="flex items-center space-x-1.5">
                          <p className="font-medium">{getDisplayName(market)}</p>
                          <TagBadges tags={em.tags} maxLeverage={market.maxLeverage} />
                        </div>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <p className="text-sm text-gray-400">
                            ${formatPrice(price)}
                          </p>
                          {change !== undefined && (
                            <p className={`text-xs ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {formatChange(change)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    {market.name === selectedMarket && (
                      <svg
                        className="w-5 h-5 text-indigo-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TagBadges({ tags, maxLeverage }: { tags: string[]; maxLeverage: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {tags.map((tag) => {
        let colors = 'bg-gray-700 text-gray-400';
        if (tag === 'SPOT') colors = 'bg-emerald-900/50 text-emerald-400';
        if (tag === 'TRADFI') colors = 'bg-yellow-900/50 text-yellow-400';
        if (tag === 'CASH') colors = 'bg-green-900/50 text-green-400';
        if (tag === 'HIP-3') colors = 'bg-cyan-900/50 text-cyan-400';

        return (
          <span
            key={tag}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors}`}
          >
            {tag}
          </span>
        );
      })}
      {maxLeverage > 1 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-900/50 text-indigo-400">
          {maxLeverage}x
        </span>
      )}
    </span>
  );
}
