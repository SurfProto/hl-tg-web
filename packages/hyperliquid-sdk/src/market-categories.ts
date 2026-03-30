import type { AnyMarket, MarketCategory, MarketTag, EnrichedMarket } from '@repo/types';
import { getMarketBaseAsset } from './market-display';

// Known TradFi symbols on Hyperliquid (commodities, indices, FX, stocks)
const TRADFI_SYMBOLS = new Set([
  // Commodities
  'GOLD', 'SILVER', 'WTIOIL', 'BRENTOIL', 'NATGAS', 'PLATINUM', 'COPPER', 'PALLADIUM',
  // Indices
  'S&P500', 'XYZ100', 'CRCL', 'USA500', 'NIKKEI', 'DAX', 'FTSE', 'HSI',
  // FX
  'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNH', 'NZD', 'SGD', 'HKD', 'KRW', 'INR', 'MXN', 'BRL',
  // Stocks / Pre-IPO
  'TSLA', 'AAPL', 'AMZN', 'GOOG', 'MSFT', 'NVDA', 'META', 'NFLX',
  'INTC', 'AMD', 'HOOD', 'COIN', 'GME', 'AMC', 'EWY',
  'MSTR', 'SQ', 'PYPL', 'SHOP', 'UBER', 'ABNB', 'SNAP', 'RBLX',
  'NKE', 'DIS', 'BA', 'JPM', 'GS', 'V', 'MA',
]);

export function classifyMarket(market: AnyMarket, spotTokenNames?: Set<string>): MarketCategory[] {
  const categories: MarketCategory[] = ['all'];

  if (market.type === 'spot') {
    categories.push('spot');
    return categories;
  }

  // Perp markets
  categories.push('perps');

  const baseAsset = getMarketBaseAsset(market);

  if (TRADFI_SYMBOLS.has(baseAsset.toUpperCase())) {
    categories.push('tradfi');
  } else {
    categories.push('crypto');
  }

  if (market.isHip3) {
    categories.push('hip3');
  }

  return categories;
}

export function getMarketTags(market: AnyMarket, spotTokenNames?: Set<string>): MarketTag[] {
  const tags: MarketTag[] = [];
  const baseAsset = getMarketBaseAsset(market);

  if (market.type === 'spot') {
    tags.push('SPOT');
  } else {
    tags.push('PERP');
    if (market.isHip3) {
      tags.push('HIP-3');
    }
    if (TRADFI_SYMBOLS.has(baseAsset.toUpperCase())) {
      tags.push('TRADFI');
    }
    if (!market.isHip3 && spotTokenNames && spotTokenNames.has(baseAsset)) {
      tags.push('CASH');
    }
  }

  return tags;
}

export function enrichMarkets(
  markets: AnyMarket[],
  priceChanges?: Record<string, number>,
  spotTokenNames?: Set<string>,
): EnrichedMarket[] {
  const enriched = markets.map((market) => ({
    market,
    categories: classifyMarket(market, spotTokenNames),
    tags: getMarketTags(market, spotTokenNames),
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
