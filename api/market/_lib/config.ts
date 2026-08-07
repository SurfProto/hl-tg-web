export interface MarketPolicy {
  majorSymbols: string[];
  ttlSeconds: {
    mids: number;
    tickerMajor: number;
    tickerOther: number;
    depthMajor: number;
    depthOther: number;
    stats: number;
    candles: number;
    markets: number;
    accountSnapshot: number;
    accountOrders: number;
    accountFills: number;
    accountPortfolio: number;
  };
  rateLimit: {
    publicPerMinute: number;
    accountPerMinute: number;
  };
  upstreamDisabled: boolean;
}

export const DEFAULT_MARKET_POLICY: MarketPolicy = {
  majorSymbols: ["BTC", "ETH", "SOL", "HYPE"],
  ttlSeconds: {
    mids: 3,
    tickerMajor: 5,
    tickerOther: 15,
    depthMajor: 3,
    depthOther: 10,
    stats: 10,
    candles: 30,
    markets: 300,
    accountSnapshot: 2,
    accountOrders: 2,
    accountFills: 5,
    accountPortfolio: 30,
  },
  rateLimit: {
    publicPerMinute: 240,
    accountPerMinute: 120,
  },
  upstreamDisabled: false,
};

function deepMergePolicy(base: MarketPolicy, override: Partial<MarketPolicy>): MarketPolicy {
  return {
    ...base,
    ...override,
    ttlSeconds: {
      ...base.ttlSeconds,
      ...(override.ttlSeconds ?? {}),
    },
    rateLimit: {
      ...base.rateLimit,
      ...(override.rateLimit ?? {}),
    },
  };
}

export function getMarketPolicy(env: Record<string, string | undefined> = process.env): MarketPolicy {
  const raw = env.MARKET_POLICY_JSON?.trim();
  if (!raw) {
    return DEFAULT_MARKET_POLICY;
  }

  try {
    return deepMergePolicy(DEFAULT_MARKET_POLICY, JSON.parse(raw) as Partial<MarketPolicy>);
  } catch {
    return DEFAULT_MARKET_POLICY;
  }
}

export function getNetwork(env: Record<string, string | undefined> = process.env) {
  return env.VITE_HYPERLIQUID_TESTNET === "true" ? "testnet" : "mainnet";
}

export function getTtlForSymbol(args: {
  route: "ticker" | "depth";
  symbol: string;
  policy?: MarketPolicy;
}) {
  const policy = args.policy ?? getMarketPolicy();
  const isMajor = policy.majorSymbols.includes(args.symbol.toUpperCase());
  if (args.route === "ticker") {
    return isMajor ? policy.ttlSeconds.tickerMajor : policy.ttlSeconds.tickerOther;
  }

  return isMajor ? policy.ttlSeconds.depthMajor : policy.ttlSeconds.depthOther;
}
