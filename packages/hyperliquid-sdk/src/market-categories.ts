import type { AnyMarket, MarketCategory, MarketTag, EnrichedMarket } from '@repo/types';

// Known TradFi symbols on Hyperliquid (commodities, indices, FX, stocks)
const TRADFI_SYMBOLS = new Set([
  // Commodities
  'GOLD', 'SILVER', 'WTIOIL', 'BRENTOIL', 'NATGAS', 'PLATINUM',
  // Indices
  'S&P500', 'XYZ100', 'CRCL', 'USA500',
  // FX
  'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNH',
  // Stocks / Pre-IPO
  'TSLA', 'AAPL', 'AMZN', 'GOOG', 'MSFT', 'NVDA', 'META', 'NFLX',
  'INTC', 'AMD', 'HOOD', 'COIN', 'GME', 'AMC', 'EWY',
]);

// HIP-3 tokens are USDT-quoted perpetuals (cash-settled)
// These are identified by their quote being USDT in the allMids key or by known HIP-3 launches
const HIP3_SYMBOLS = new Set([
  'USA500', 'SILVER', 'TSLA', 'HOOD', 'WTI', 'INTC', 'NVDA',
  'AMZN', 'EWY', 'GOLD',
]);

// Pre-launch markets (coins not yet fully live)
const PRELAUNCH_SYMBOLS = new Set<string>([
  // Add pre-launch symbols as they appear
]);

export function classifyMarket(market: AnyMarket): MarketCategory[] {
  const categories: MarketCategory[] = ['all'];

  if (market.type === 'spot') {
    categories.push('spot');
    return categories;
  }

  // Perp markets
  categories.push('perps');

  const name = market.name.toUpperCase();

  if (TRADFI_SYMBOLS.has(name)) {
    categories.push('tradfi');
  } else {
    categories.push('crypto');
  }

  if (HIP3_SYMBOLS.has(name)) {
    categories.push('hip3');
  }

  if (PRELAUNCH_SYMBOLS.has(name)) {
    categories.push('prelaunch');
  }

  return categories;
}

export function getMarketTags(market: AnyMarket): MarketTag[] {
  const tags: MarketTag[] = [];

  if (market.type === 'spot') {
    tags.push('SPOT');
  } else {
    tags.push('PERP');
    const name = market.name.toUpperCase();
    if (TRADFI_SYMBOLS.has(name)) {
      tags.push('xyz');
    }
    if (HIP3_SYMBOLS.has(name)) {
      tags.push('cash');
    }
  }

  return tags;
}

export function enrichMarkets(
  markets: AnyMarket[],
  priceChanges?: Record<string, number>,
): EnrichedMarket[] {
  const enriched = markets.map((market) => ({
    market,
    categories: classifyMarket(market),
    tags: getMarketTags(market),
  }));

  // For trending: mark top 20 by absolute 24h change
  if (priceChanges) {
    const withChanges = enriched
      .filter((em) => priceChanges[em.market.name] !== undefined)
      .sort((a, b) =>
        Math.abs(priceChanges[b.market.name] ?? 0) - Math.abs(priceChanges[a.market.name] ?? 0)
      );

    const trendingNames = new Set(withChanges.slice(0, 20).map((em) => em.market.name));
    for (const em of enriched) {
      if (trendingNames.has(em.market.name)) {
        em.categories.push('trending');
      }
    }
  }

  return enriched;
}

export const CATEGORY_LABELS: Record<MarketCategory, string> = {
  all: 'All',
  perps: 'Perps',
  spot: 'Spot',
  crypto: 'Crypto',
  tradfi: 'Tradfi',
  hip3: 'HIP-3',
  trending: 'Trending',
  prelaunch: 'Pre-launch',
};

export const CATEGORY_ORDER: MarketCategory[] = [
  'all', 'perps', 'spot', 'crypto', 'tradfi', 'hip3', 'trending', 'prelaunch',
];
