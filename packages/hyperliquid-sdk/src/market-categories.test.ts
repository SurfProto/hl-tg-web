import { describe, expect, it } from 'vitest';
import type { PerpMarket, SpotMarket } from '@repo/types';
import {
  classifyMarket,
  enrichMarkets,
  getMarketSubCategory,
  getMarketTags,
} from './market-categories';

function createPerpMarket(overrides: Partial<PerpMarket> = {}): PerpMarket {
  return {
    type: 'perp',
    name: 'BTC',
    index: 0,
    szDecimals: 3,
    maxLeverage: 20,
    onlyIsolated: false,
    isDelisted: false,
    minNotionalUsd: 10,
    minBaseSize: 0.001,
    ...overrides,
  };
}

function createSpotMarket(overrides: Partial<SpotMarket> = {}): SpotMarket {
  return {
    type: 'spot',
    name: 'PURR/USDC',
    index: 0,
    tokens: [0, 1],
    baseName: 'PURR',
    quoteName: 'USDC',
    szDecimals: 2,
    maxLeverage: 1,
    onlyIsolated: false,
    isDelisted: false,
    minNotionalUsd: 10,
    minBaseSize: 1,
    ...overrides,
  };
}

describe('classifyMarket', () => {
  it('classifies spot markets without perp-only categories', () => {
    expect(classifyMarket(createSpotMarket())).toEqual(['all', 'spot']);
  });

  it('classifies crypto perps under perps and crypto', () => {
    expect(classifyMarket(createPerpMarket({ name: 'BTC' }))).toEqual(['all', 'perps', 'crypto']);
  });

  it('classifies tradfi perps even when the market name carries a stable suffix', () => {
    expect(classifyMarket(createPerpMarket({ name: 'GOLD-USDC' }))).toEqual(['all', 'perps', 'tradfi']);
  });

  it('routes HIP-3 markets into tradfi without the legacy HIP-3 category', () => {
    const market = createPerpMarket({
      name: 'vault:GOLD-USDC',
      dex: 'vault',
      isHip3: true,
    });

    expect(classifyMarket(market)).toEqual(['all', 'tradfi']);
  });

  it('keeps pre-launch perps out of crypto and tradfi buckets', () => {
    expect(classifyMarket(createPerpMarket({ name: 'MEGA-USDC' }))).toEqual(['all', 'perps', 'prelaunch']);
  });
});

describe('getMarketSubCategory', () => {
  it('assigns quote-based spot subcategories', () => {
    expect(getMarketSubCategory(createSpotMarket({ quoteName: 'USDC' }))).toBe('usdc');
    expect(getMarketSubCategory(createSpotMarket({ quoteName: 'USDH' }))).toBe('usdh');
    expect(getMarketSubCategory(createSpotMarket({ quoteName: 'USDT' }))).toBe('usdt');
  });

  it('assigns curated crypto and tradfi subcategories from the normalized base symbol', () => {
    expect(getMarketSubCategory(createPerpMarket({ name: 'BTC' }))).toBe('layer1');
    expect(getMarketSubCategory(createPerpMarket({ name: 'GOLD-USDC' }))).toBe('commodities');
    expect(
      getMarketSubCategory(
        createPerpMarket({ name: 'vault:AAPL-USDC', dex: 'vault', isHip3: true })
      )
    ).toBe('stocks');
  });
});

describe('getMarketTags', () => {
  it('marks normalized tradfi names and spot-backed perps', () => {
    const tags = getMarketTags(createPerpMarket({ name: 'GOLD-USDC' }), new Set(['GOLD-USDC']));

    expect(tags).toEqual(['PERP', 'TRADFI', 'CASH']);
  });

  it('does not assign CASH to HIP-3 markets', () => {
    const tags = getMarketTags(
      createPerpMarket({ name: 'vault:GOLD-USDC', dex: 'vault', isHip3: true }),
      new Set(['GOLD-USDC'])
    );

    expect(tags).toEqual(['PERP', 'TRADFI']);
  });
});

describe('enrichMarkets', () => {
  it('adds subcategories and trending flags from price-change ranking', () => {
    const markets = [
      createPerpMarket({ name: 'BTC' }),
      createPerpMarket({ name: 'MEGA-USDC' }),
      createSpotMarket({ name: 'PURR/USDT', quoteName: 'USDT' }),
    ];

    const enriched = enrichMarkets(markets, {
      BTC: 2,
      'MEGA-USDC': -15,
      'PURR/USDT': 1,
    });

    expect(enriched[0].subCategory).toBe('layer1');
    expect(enriched[1].categories).toContain('trending');
    expect(enriched[1].categories).toContain('prelaunch');
    expect(enriched[2].subCategory).toBe('usdt');
  });
});
