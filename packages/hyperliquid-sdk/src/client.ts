import type { AccountState, Order, WsMessage } from '@repo/types';
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
    const raw = await client.l2Book({ coin });
    return {
      coin: raw.coin,
      time: raw.time,
      levels: {
        bids: raw.levels[0].map((l: any) => ({ px: parseFloat(l.px), sz: parseFloat(l.sz), n: l.n })),
        asks: raw.levels[1].map((l: any) => ({ px: parseFloat(l.px), sz: parseFloat(l.sz), n: l.n })),
      },
    };
  }

  // Get candles (last 7 days)
  async getCandles(coin: string, interval: string) {
    const client = await this.getPublicClient();
    const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const raw = await client.candleSnapshot({ coin, interval, startTime });
    return raw.map((c: any) => ({
      t: c.t,
      T: c.T,
      s: c.s,
      i: c.i,
      o: parseFloat(c.o),
      h: parseFloat(c.h),
      l: parseFloat(c.l),
      c: parseFloat(c.c),
      v: parseFloat(c.v),
      n: c.n,
    }));
  }

  // Get user state
  async getUserState(): Promise<AccountState> {
    const client = await this.getPublicClient();
    const raw = await client.clearinghouseState({ user: this.walletAddress as `0x${string}` });

    const parseMarginSummary = (ms: any) => ({
      accountValue: parseFloat(ms.accountValue),
      totalMarginUsed: parseFloat(ms.totalMarginUsed),
      totalNtlPos: parseFloat(ms.totalNtlPos),
      totalRawUsd: parseFloat(ms.totalRawUsd),
    });

    return {
      marginSummary: parseMarginSummary(raw.marginSummary),
      crossMarginSummary: parseMarginSummary(raw.crossMarginSummary),
      crossMaintenanceMarginUsed: parseFloat(raw.crossMaintenanceMarginUsed),
      withdrawable: parseFloat(raw.withdrawable),
      assetPositions: (raw.assetPositions ?? []).map((ap: any) => ({
        type: ap.type,
        position: {
          coin: ap.position.coin,
          szi: parseFloat(ap.position.szi),
          leverage: {
            type: ap.position.leverage.type,
            value: parseFloat(ap.position.leverage.value),
          },
          entryPx: parseFloat(ap.position.entryPx),
          positionValue: parseFloat(ap.position.positionValue),
          unrealizedPnl: parseFloat(ap.position.unrealizedPnl),
          returnOnEquity: parseFloat(ap.position.returnOnEquity),
          liquidationPx: ap.position.liquidationPx != null
            ? parseFloat(ap.position.liquidationPx)
            : null,
          marginUsed: parseFloat(ap.position.marginUsed),
          maxLeverage: parseFloat(ap.position.maxLeverage),
        },
      })),
    };
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

  // Approve builder fee for this user
  async approveBuilderFee(builder: string, maxFeeRate: string) {
    const client = await this.getWalletClient();
    return client.approveBuilderFee({
      builder: builder as `0x${string}`,
      maxFeeRate: maxFeeRate as `${string}%`,
    });
  }

  // Check max approved builder fee for this user
  async getMaxBuilderFee(builder: string): Promise<number> {
    const client = await this.getPublicClient();
    return client.maxBuilderFee({
      user: this.walletAddress as `0x${string}`,
      builder: builder as `0x${string}`,
    });
  }

  // Get spot account balance (HL L1 spot)
  async getSpotBalance() {
    const client = await this.getPublicClient();
    return client.spotClearinghouseState({ user: this.walletAddress as `0x${string}` });
  }

  // Transfer USDC between Perps and Spot accounts on HL L1
  async usdClassTransfer(amount: string, toPerp: boolean) {
    const client = await this.getWalletClient();
    return client.usdClassTransfer({ amount, toPerp });
  }

  // Withdraw USDC from HL L1 to Arbitrum address
  async withdraw(destination: string, amount: string) {
    const client = await this.getWalletClient();
    return client.withdraw3({ destination: destination as `0x${string}`, amount });
  }
}
