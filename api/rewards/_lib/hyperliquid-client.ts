interface HyperliquidClientConfig {
  customSigner?: unknown;
  testnet?: boolean;
  walletAddress?: string;
}

export type RewardsHyperliquidClient = {
  getFills(): Promise<
    Array<{
      cloid?: string | null;
      hash: string;
      oid: number;
      px: number;
      sz: number;
      tid: number;
      time: number;
    }>
  >;
  usdSend(destination: string, amount: string): Promise<unknown>;
};

type HyperliquidClientConstructor = new (
  config: HyperliquidClientConfig,
) => RewardsHyperliquidClient;

async function loadHyperliquidClientConstructor(): Promise<HyperliquidClientConstructor> {
  const module = await import("../../../packages/hyperliquid-sdk/src/client");
  return module.HyperliquidClient as HyperliquidClientConstructor;
}

export async function createRewardsHyperliquidClient(config: HyperliquidClientConfig) {
  const HyperliquidClient = await loadHyperliquidClientConstructor();
  return new HyperliquidClient(config);
}
