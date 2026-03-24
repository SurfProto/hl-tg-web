import type { Order, WsMessage } from '@repo/types';
import { injectBuilderCode } from './builder';
import { WebSocketManager } from './ws';

// Dynamic import for Hyperliquid SDK
let HyperliquidSDK: any = null;

async function loadHyperliquidSDK() {
  if (!HyperliquidSDK) {
    const module = await import('@nktkas/hyperliquid');
    HyperliquidSDK = module;
  }
  return HyperliquidSDK;
}

export interface HyperliquidClientConfig {
  walletAddress?: string;
  customSigner?: unknown;
  testnet?: boolean;
}

export class HyperliquidClient {
  private publicClientInstance: any = null;
  private walletClientInstance: any = null;
  private wsManager: WebSocketManager;
  private walletAddress: string;
  private testnet: boolean;
  private config: HyperliquidClientConfig;
  private perpIndexCache: Record<string, number> | null = null;

  constructor(config: HyperliquidClientConfig) {
    this.walletAddress = config.walletAddress ?? '';
    this.testnet = config.testnet ?? false;
    this.config = config;
    this.wsManager = new WebSocketManager(this.testnet);
  }

  private async getPublicClient() {
    if (!this.publicClientInstance) {
      const SDK = await loadHyperliquidSDK();
      const transport = new SDK.HttpTransport({
        url: this.testnet ? 'https://hyperliquid-testnet.xyz' : 'https://hyperliquid.xyz',
      });
      this.publicClientInstance = new SDK.PublicClient({ transport });
    }
    return this.publicClientInstance;
  }

  private async getWalletClient() {
    if (!this.walletClientInstance) {
      if (!this.config.customSigner) throw new Error('Wallet not connected');
      const SDK = await loadHyperliquidSDK();
      const transport = new SDK.HttpTransport({
        url: this.testnet ? 'https://hyperliquid-testnet.xyz' : 'https://hyperliquid.xyz',
      });
      this.walletClientInstance = new SDK.WalletClient({
        transport,
        wallet: this.config.customSigner,
        isTestnet: this.testnet,
      });
    }
    return this.walletClientInstance;
  }

  private async getPerpIndex(coin: string): Promise<number> {
    if (!this.perpIndexCache) {
      const client = await this.getPublicClient();
      const [perpMeta] = await client.metaAndAssetCtxs();
      this.perpIndexCache = {};
      perpMeta.universe.forEach((u: any, i: number) => {
        this.perpIndexCache![u.name] = i;
      });
    }
    const index = this.perpIndexCache[coin];
    if (index === undefined) throw new Error(`Unknown coin: ${coin}`);
    return index;
  }

  // WebSocket methods
  async connectWs(): Promise<void> {
    return this.wsManager.connect();
  }

  disconnectWs(): void {
    this.wsManager.disconnect();
  }

  isWsConnected(): boolean {
    return this.wsManager.isConnected();
  }

  subscribeToOrderbook(coin: string, callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe(`l2Book:${coin}`, callback);
  }

  subscribeToTrades(coin: string, callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe(`trades:${coin}`, callback);
  }

  subscribeToCandles(coin: string, interval: string, callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe(`candle:${coin}:${interval}`, callback);
  }

  subscribeToUserEvents(callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe('userEvents', callback);
  }

  subscribeToAllMids(callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe('allMids', callback);
  }

  // Get all markets (spot + perp)
  async getMarkets() {
    const client = await this.getPublicClient();
    const [spotMeta, metaAndCtxs] = await Promise.all([
      client.spotMeta(),
      client.metaAndAssetCtxs(),
    ]);
    return {
      spot: spotMeta.tokens,
      perp: metaAndCtxs[0].universe,
    };
  }

  // Get market prices
  async getMids() {
    const client = await this.getPublicClient();
    return client.allMids();
  }

  // Get orderbook
  async getOrderbook(coin: string) {
    const client = await this.getPublicClient();
    return client.l2Book({ coin });
  }

  // Get candles (last 7 days)
  async getCandles(coin: string, interval: string) {
    const client = await this.getPublicClient();
    const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return client.candleSnapshot({ coin, interval, startTime });
  }

  // Get user state
  async getUserState() {
    const client = await this.getPublicClient();
    return client.clearinghouseState({ user: this.walletAddress as `0x${string}` });
  }

  // Get open orders
  async getOpenOrders() {
    const client = await this.getPublicClient();
    return client.openOrders({ user: this.walletAddress as `0x${string}` });
  }

  // Get fills
  async getFills() {
    const client = await this.getPublicClient();
    return client.userFills({ user: this.walletAddress as `0x${string}` });
  }

  // Place order with builder code
  async placeOrder(order: Order) {
    const client = await this.getWalletClient();
    const orderWithBuilder = injectBuilderCode(order);
    const assetIndex = await this.getPerpIndex(order.coin);

    return client.order({
      orders: [{
        a: assetIndex,
        b: order.side === 'buy',
        p: String(order.limitPx ?? 0),
        s: String(order.sz),
        r: order.reduceOnly,
        t: order.orderType === 'market'
          ? { limit: { tif: 'Ioc' } }
          : { limit: { tif: 'Gtc' } },
        c: order.cloid as `0x${string}` | undefined,
      }],
      grouping: 'na',
      builder: orderWithBuilder.builder ? {
        b: orderWithBuilder.builder.b as `0x${string}`,
        f: orderWithBuilder.builder.f,
      } : undefined,
    });
  }

  // Cancel order
  async cancelOrder(coin: string, oid: number) {
    const client = await this.getWalletClient();
    const assetIndex = await this.getPerpIndex(coin);
    return client.cancel({
      cancels: [{ a: assetIndex, o: oid }],
    });
  }

  // Cancel all orders (optionally for a specific coin)
  async cancelAllOrders(coin?: string) {
    const client = await this.getWalletClient();
    const openOrders = await this.getOpenOrders();
    const toCancel = coin
      ? openOrders.filter((o: any) => o.coin === coin)
      : openOrders;

    if (toCancel.length === 0) return;

    const cancels = await Promise.all(
      toCancel.map(async (o: any) => ({
        a: await this.getPerpIndex(o.coin),
        o: o.oid,
      }))
    );

    return client.cancel({ cancels });
  }

  // Modify order
  async modifyOrder(oid: number, order: Order) {
    const client = await this.getWalletClient();
    const assetIndex = await this.getPerpIndex(order.coin);

    return client.modify({
      oid,
      order: {
        a: assetIndex,
        b: order.side === 'buy',
        p: String(order.limitPx ?? 0),
        s: String(order.sz),
        r: order.reduceOnly,
        t: order.orderType === 'market'
          ? { limit: { tif: 'Ioc' } }
          : { limit: { tif: 'Gtc' } },
        c: order.cloid as `0x${string}` | undefined,
      },
    });
  }

  // Update leverage
  async updateLeverage(coin: string, leverage: number, isCross: boolean = true) {
    const client = await this.getWalletClient();
    const assetIndex = await this.getPerpIndex(coin);
    return client.updateLeverage({
      asset: assetIndex,
      isCross,
      leverage,
    });
  }

  // Update isolated margin
  async updateIsolatedMargin(coin: string, amount: number) {
    const client = await this.getWalletClient();
    const assetIndex = await this.getPerpIndex(coin);
    return client.updateIsolatedMargin({
      asset: assetIndex,
      isBuy: true,
      ntli: amount,
    });
  }

  // Get funding history
  async getFundingHistory(coin: string, startTime?: number) {
    const client = await this.getPublicClient();
    return client.fundingHistory({
      coin,
      startTime: startTime ?? Date.now() - 7 * 24 * 60 * 60 * 1000,
    });
  }

  // Get predicted funding rates
  async getPredictedFundingRates() {
    const client = await this.getPublicClient();
    return client.predictedFundings();
  }

  // Get historical orders
  async getHistoricalOrders() {
    const client = await this.getPublicClient();
    return client.historicalOrders({ user: this.walletAddress as `0x${string}` });
  }

  // Get user funding
  async getUserFunding() {
    const client = await this.getPublicClient();
    return client.userFunding({ user: this.walletAddress as `0x${string}` });
  }

  // Get portfolio
  async getPortfolio() {
    const client = await this.getPublicClient();
    return client.portfolio({ user: this.walletAddress as `0x${string}` });
  }
}
