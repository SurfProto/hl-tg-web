import { describe, expect, it } from 'vitest';
import type { PerpMarket, SpotMarket } from '@repo/types';
import {
  getMarketBaseAsset,
  getMarketDisplayName,
  getMarketSearchTerms,
} from './market-display';

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

describe('getMarketDisplayName', () => {
  it('formats HIP-3 perps as coin:dex', () => {
    const market = createPerpMarket({
      name: 'vault:GOLD-USDC',
      dex: 'vault',
      isHip3: true,
    });

    expect(getMarketDisplayName(market)).toBe('GOLD-USDC:vault');
  });

  it('keeps spot display names as base/quote', () => {
    const market = createSpotMarket();

    expect(getMarketDisplayName(market)).toBe('PURR/USDC');
  });
});

describe('getMarketBaseAsset', () => {
  it('returns the stripped coin name for HIP-3 perps', () => {
    const market = createPerpMarket({
      name: 'vault:GOLD-USDC',
      dex: 'vault',
      isHip3: true,
    });

    expect(getMarketBaseAsset(market)).toBe('GOLD-USDC');
  });

  it('uses the spot base symbol for spot markets', () => {
    const market = createSpotMarket();

    expect(getMarketBaseAsset(market)).toBe('PURR');
  });
});

describe('getMarketSearchTerms', () => {
  it('includes dex identifiers for HIP-3 perps', () => {
    const market = createPerpMarket({
      name: 'vault:GOLD-USDC',
      dex: 'vault',
      isHip3: true,
    });

    expect(getMarketSearchTerms(market)).toEqual(
      expect.arrayContaining(['vault:GOLD-USDC', 'GOLD-USDC:vault', 'GOLD-USDC', 'vault'])
    );
  });

  it('includes canonical spot names without duplicates', () => {
    const market = createSpotMarket();
    const searchTerms = getMarketSearchTerms(market);

    expect(searchTerms).toEqual(expect.arrayContaining(['PURR/USDC', 'PURR', 'USDC']));
    expect(new Set(searchTerms).size).toBe(searchTerms.length);
  });
});
