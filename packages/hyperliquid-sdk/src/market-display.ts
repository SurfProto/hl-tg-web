import type { AnyMarket } from '@repo/types';

function stripDexPrefix(name: string): string {
  const separatorIndex = name.indexOf(':');
  return separatorIndex === -1 ? name : name.slice(separatorIndex + 1);
}

function parseHip3String(name: string) {
  const separatorIndex = name.indexOf(':');
  if (separatorIndex === -1) return null;

  const left = name.slice(0, separatorIndex);
  const right = name.slice(separatorIndex + 1);

  return {
    left,
    right,
    // Internal API form: dex:COIN-USDC
    isDexPrefixed: !left.includes('-') && right.includes('-'),
    // Display/router form introduced by recent HIP-3 UI changes: COIN-USDC:dex
    isDisplayFormatted: left.includes('-') && !right.includes('-'),
  };
}

export function getMarketDisplayName(market: AnyMarket | string): string {
  if (typeof market === 'string') {
    const parsed = parseHip3String(market);
    if (parsed?.isDisplayFormatted) return market;
    if (parsed?.isDexPrefixed) return parsed.right;
    return stripDexPrefix(market);
  }

  if (market.type === 'spot') {
    const baseName = market.baseName || stripDexPrefix(market.name);
    const quoteName = market.quoteName || 'USDC';
    return `${baseName}/${quoteName}`;
  }

  if (market.isHip3 && market.dex) {
    const coinPart = stripDexPrefix(market.name); // e.g. GOLD-USDC (suffix kept)
    return `${coinPart}:${market.dex}`;            // → GOLD-USDC:xyz
  }

  return stripDexPrefix(market.name);
}

export function getMarketBaseAsset(market: AnyMarket | string): string {
  if (typeof market !== 'string' && market.type === 'perp' && market.isHip3) {
    // For HIP-3 display names are `COIN:dex` — base asset is just the coin part (before `:`)
    // Use internal name directly: `dex:COIN` → strip prefix → `COIN`
    return stripDexPrefix(market.name);
  }
  if (typeof market === 'string') {
    const parsed = parseHip3String(market);
    if (parsed?.isDisplayFormatted) return parsed.left;
    if (parsed?.isDexPrefixed) return parsed.right;
  }
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
    if (market.isHip3 && market.dex) {
      terms.add(market.dex);
    }
  }

  return [...terms].filter(Boolean);
}
