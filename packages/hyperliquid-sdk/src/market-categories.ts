import type { AnyMarket, MarketCategory, MarketSubCategory, MarketTag, EnrichedMarket } from '@repo/types';
import { getMarketBaseAsset } from './market-display';

// ─── TradFi sub-sets ────────────────────────────────────────────────────────

const TRADFI_COMMODITIES = new Set([
  'GOLD', 'SILVER', 'WTIOIL', 'BRENTOIL', 'NATGAS', 'PLATINUM', 'COPPER', 'PALLADIUM',
]);
const TRADFI_INDICES = new Set([
  'S&P500', 'XYZ100', 'CRCL', 'USA500', 'NIKKEI', 'DAX', 'FTSE', 'HSI',
]);
const TRADFI_FX = new Set([
  'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNH', 'NZD', 'SGD', 'HKD', 'KRW', 'INR', 'MXN', 'BRL',
]);
const TRADFI_STOCKS = new Set([
  'TSLA', 'AAPL', 'AMZN', 'GOOG', 'MSFT', 'NVDA', 'META', 'NFLX',
  'INTC', 'AMD', 'HOOD', 'COIN', 'GME', 'AMC', 'EWY',
  'MSTR', 'SQ', 'PYPL', 'SHOP', 'UBER', 'ABNB', 'SNAP', 'RBLX',
  'NKE', 'DIS', 'BA', 'JPM', 'GS', 'V', 'MA',
]);
const TRADFI_SYMBOLS = new Set([
  ...TRADFI_COMMODITIES, ...TRADFI_INDICES, ...TRADFI_FX, ...TRADFI_STOCKS,
]);

// ─── Pre-launch ──────────────────────────────────────────────────────────────

const PRE_LAUNCH_SYMBOLS = new Set(['MEGA']);

// ─── Crypto sub-category map ─────────────────────────────────────────────────
// The Hyperliquid API has no category metadata — this is the curated map.
// Rule: one entry per coin, primary identity wins.
// Coins not in this map still appear under the "All" sub-filter of the Crypto tab.

export const COIN_SUBCATEGORY_MAP: Record<string, MarketSubCategory> = {
  // Layer 1 — native blockchains with own consensus
  BTC: 'layer1', ETH: 'layer1', SOL: 'layer1', AVAX: 'layer1', ADA: 'layer1',
  DOT: 'layer1', NEAR: 'layer1', ATOM: 'layer1', FTM: 'layer1', APT: 'layer1',
  SUI: 'layer1', SEI: 'layer1', TON: 'layer1', INJ: 'layer1', TRX: 'layer1',
  XRP: 'layer1', BNB: 'layer1', LTC: 'layer1', BCH: 'layer1', ETC: 'layer1',
  ALGO: 'layer1', HBAR: 'layer1', KAS: 'layer1', XLM: 'layer1', VET: 'layer1',
  EGLD: 'layer1', FLOW: 'layer1', KAVA: 'layer1', OSMO: 'layer1', KSEI: 'layer1',

  // Layer 2 — rollups and scaling solutions
  ARB: 'layer2', OP: 'layer2', MATIC: 'layer2', STRK: 'layer2', BLAST: 'layer2',
  MANTA: 'layer2', METIS: 'layer2', ZKJ: 'layer2', ZK: 'layer2', SCROLL: 'layer2',
  TAIKO: 'layer2', BOBA: 'layer2', IMX: 'layer2', LOOPRING: 'layer2',

  // Defi — on-chain financial protocols
  UNI: 'defi', AAVE: 'defi', CRV: 'defi', MKR: 'defi', SNX: 'defi',
  COMP: 'defi', BAL: 'defi', YFI: 'defi', SUSHI: 'defi', JUP: 'defi',
  KMNO: 'defi', PENDLE: 'defi', ENA: 'defi', ETHFI: 'defi', REZ: 'defi',
  GMX: 'defi', DYDX: 'defi', PERP: 'defi', LQTY: 'defi',
  LDO: 'defi', RPL: 'defi', FXS: 'defi', CVX: 'defi',
  CAKE: 'defi', RAY: 'defi', ORCA: 'defi', HYPE: 'defi', PURR: 'defi',

  // AI — artificial intelligence as core product
  TAO: 'ai', RENDER: 'ai', GRASS: 'ai', AKT: 'ai', FET: 'ai',
  AGIX: 'ai', OCEAN: 'ai', GRT: 'ai', LPT: 'ai', WLD: 'ai',
  ATH: 'ai', OLAS: 'ai', VIRTUAL: 'ai', AI16Z: 'ai', GRIFFAIN: 'ai',
  SWARMS: 'ai', ZEREBRO: 'ai', VAPOR: 'ai',

  // Gaming — web3 gaming and metaverse
  AXS: 'gaming', SAND: 'gaming', MANA: 'gaming', GALA: 'gaming',
  BEAM: 'gaming', RON: 'gaming', PIXEL: 'gaming', MAGIC: 'gaming',
  PRIME: 'gaming', YGG: 'gaming', ILV: 'gaming', SLP: 'gaming',

  // Meme — community/meme origin
  DOGE: 'meme', SHIB: 'meme', PEPE: 'meme', WIF: 'meme', BONK: 'meme',
  POPCAT: 'meme', FLOKI: 'meme', BRETT: 'meme', MOG: 'meme', GOAT: 'meme',
  MOODENG: 'meme', PNUT: 'meme', COW: 'meme', TRUMP: 'meme', MELANIA: 'meme',
  FARTCOIN: 'meme', BOME: 'meme', MEW: 'meme', SLERF: 'meme', TURBO: 'meme',
  NEIRO: 'meme', PONKE: 'meme',
};

// ─── Classification ──────────────────────────────────────────────────────────

export function classifyMarket(market: AnyMarket): MarketCategory[] {
  const categories: MarketCategory[] = ['all'];

  if (market.type === 'spot') {
    categories.push('spot');
    return categories;
  }

  const base = getMarketBaseAsset(market).toUpperCase();

  if (market.isHip3) {
    categories.push('hip3');
    // HIP-3 markets also appear in tradfi/crypto tabs based on their underlying asset
    categories.push(TRADFI_SYMBOLS.has(base) ? 'tradfi' : 'crypto');
    return categories;
  }

  categories.push('perps');

  if (PRE_LAUNCH_SYMBOLS.has(base)) {
    categories.push('prelaunch');
    return categories;
  }

  categories.push(TRADFI_SYMBOLS.has(base) ? 'tradfi' : 'crypto');
  return categories;
}

export function getMarketSubCategory(market: AnyMarket): MarketSubCategory | undefined {
  if (market.type === 'spot') {
    const q = market.quoteName?.toUpperCase();
    if (q === 'USDC') return 'usdc';
    if (q === 'USDH') return 'usdh';
    if (q === 'USDT') return 'usdt';
    return undefined;
  }
  const base = getMarketBaseAsset(market).toUpperCase();
  if (TRADFI_STOCKS.has(base))      return 'stocks';
  if (TRADFI_INDICES.has(base))     return 'indices';
  if (TRADFI_COMMODITIES.has(base)) return 'commodities';
  if (TRADFI_FX.has(base))          return 'fx';
  return COIN_SUBCATEGORY_MAP[base];
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
    categories: classifyMarket(market),
    tags: getMarketTags(market, spotTokenNames),
    subCategory: getMarketSubCategory(market),
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

// ─── UI config ───────────────────────────────────────────────────────────────

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

export type SubFilterConfig = { key: MarketSubCategory; label: string }[];

export const SUB_FILTERS: Partial<Record<MarketCategory, SubFilterConfig>> = {
  spot: [
    { key: 'usdc', label: 'USDC' },
    { key: 'usdh', label: 'USDH' },
    { key: 'usdt', label: 'USDT' },
  ],
  crypto: [
    { key: 'ai', label: 'AI' },
    { key: 'defi', label: 'Defi' },
    { key: 'gaming', label: 'Gaming' },
    { key: 'layer1', label: 'Layer 1' },
    { key: 'layer2', label: 'Layer 2' },
    { key: 'meme', label: 'Meme' },
  ],
  tradfi: [
    { key: 'stocks', label: 'Stocks' },
    { key: 'indices', label: 'Indices' },
    { key: 'commodities', label: 'Commodities' },
    { key: 'fx', label: 'FX' },
  ],
};
