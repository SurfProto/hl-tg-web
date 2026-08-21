export interface MarketPolicy {
  majorSymbols: string[];
  ttlSeconds: {
    mids: number;
    tickerMajor: number;
    tickerOther: number;
    depthMajor: number;
    depthOther: number;
    stats: number;
    perpDexs: number;
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
    // fetchStats rebuilt in ~2s and expired in 10, so a user landed on the
    // rebuild roughly every third request. This is open interest, 24h volume
    // and funding — live price comes from ticker and mids at 3-5s, so a
    // longer window here does not make prices stale. Paired with the
    // warming cron in vercel.json, which only refreshes an expired entry, so
    // this must stay at or under the cron interval to be warmed at all.
    stats: 60,
    // The list of HIP-3 dexes changes when a new dex launches, not by the
    // second, and it gates the second wave of the stats fan-out.
    perpDexs: 900,
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
  } catch (error) {
    // Falling back to defaults is the right runtime behaviour, but doing it
    // silently means a typo in the policy blob looks like it took effect.
    console.error(
      "MARKET_POLICY_JSON is not valid JSON; using DEFAULT_MARKET_POLICY.",
      error instanceof Error ? error.message : error,
    );
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
