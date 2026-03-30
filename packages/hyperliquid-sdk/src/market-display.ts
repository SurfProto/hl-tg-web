import type { AnyMarket } from '@repo/types';

function stripDexPrefix(name: string): string {
  const separatorIndex = name.indexOf(':');
  return separatorIndex === -1 ? name : name.slice(separatorIndex + 1);
}

export function getMarketDisplayName(market: AnyMarket | string): string {
  if (typeof market === 'string') {
    return stripDexPrefix(market);
  }

  if (market.type === 'spot') {
    const baseName = market.baseName || stripDexPrefix(market.name);
    const quoteName = market.quoteName || 'USDC';
    return `${baseName}/${quoteName}`;
  }

  return stripDexPrefix(market.name);
}

export function getMarketBaseAsset(market: AnyMarket | string): string {
  return getMarketDisplayName(market).split('/')[0];
}

export function getMarketSearchTerms(market: AnyMarket): string[] {
  const terms = new Set<string>([
    market.name,
    getMarketDisplayName(market),
    getMarketBaseAsset(market),
  ]);

  if (market.type === 'spot') {
    terms.add(market.baseName);
    terms.add(market.quoteName);
    terms.add(`${market.baseName}/${market.quoteName}`);
  } else {
    terms.add(getMarketDisplayName(market));
  }

  return [...terms].filter(Boolean);
}
