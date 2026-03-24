import type { Order, BuilderCode, WsMessage } from '@repo/types';
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
  walletAddress: string;
  customSigner?: unknown;
  testnet?: boolean;
}

export class HyperliquidClient {
  private client: any = null;
  private wsManager: WebSocketManager;
  private walletAddress: string;
  private testnet: boolean;
  private config: HyperliquidClientConfig;

  constructor(config: HyperliquidClientConfig) {
    this.walletAddress = config.walletAddress;
    this.testnet = config.testnet ?? false;
    this.config = config;
    this.wsManager = new WebSocketManager(this.testnet);
  }

  private async getClient() {
    if (!this.client) {
      const SDK = await loadHyperliquidSDK();
      this.client = new SDK.Hyperliquid({
        walletAddress: this.config.walletAddress,
        customSigner: this.config.customSigner,
        testnet: this.testnet,
      });
    }
    return this.client;
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

  // Get all markets (spot + perp + HIP-3)
  async getMarkets() {
    const client = await this.getClient();
    const [spotMeta, perpMeta] = await Promise.all([
      client.info.spotMeta(),
      client.info.meta(),
    ]);

    return {
      spot: spotMeta.tokens,
      perp: perpMeta.universe,
    };
  }

  // Get market prices
  async getMids() {
    const client = await this.getClient();
    return client.info.allMids();
  }

  // Get orderbook
  async getOrderbook(coin: string) {
    const client = await this.getClient();
    return client.info.l2Book({ coin });
  }

  // Get candles
  async getCandles(coin: string, interval: string) {
    const client = await this.getClient();
    return client.info.candleSnapshot({ coin, interval });
  }

  // Get user state
  async getUserState() {
    const client = await this.getClient();
    return client.info.userState({ user: this.walletAddress });
  }

  // Get open orders
  async getOpenOrders() {
    const client = await this.getClient();
    return client.info.openOrders({ user: this.walletAddress });
  }

  // Get fills
  async getFills() {
    const client = await this.getClient();
    return client.info.userFills({ user: this.walletAddress });
  }

  // Place order with builder code
  async placeOrder(order: Order) {
    const client = await this.getClient();
    const orderWithBuilder = injectBuilderCode(order);
    
    return client.exchange.placeOrder({
      coin: orderWithBuilder.coin,
      is_buy: orderWithBuilder.side === 'buy',
      limit_px: orderWithBuilder.limitPx ?? 0,
      sz: orderWithBuilder.sz,
      reduce_only: orderWithBuilder.reduceOnly,
      order_type: orderWithBuilder.orderType === 'market' ? { market: {} } : { limit: { tif: 'Gtc' } },
      cloid: orderWithBuilder.cloid,
      builder: orderWithBuilder.builder,
    });
  }

  // Cancel order
  async cancelOrder(coin: string, oid: number) {
    const client = await this.getClient();
    return client.exchange.cancelOrder({ coin, oid });
  }

  // Cancel all orders
  async cancelAllOrders(coin?: string) {
    const client = await this.getClient();
    if (coin) {
      return client.exchange.cancelOrder({ coin, oid: 0 });
    }
    return client.exchange.cancelOrder({ coin: '', oid: 0 });
  }

  // Modify order
  async modifyOrder(oid: number, order: Order) {
    const client = await this.getClient();
    const orderWithBuilder = injectBuilderCode(order);
    
    return client.exchange.modifyOrder({
      oid,
      coin: orderWithBuilder.coin,
      is_buy: orderWithBuilder.side === 'buy',
      limit_px: orderWithBuilder.limitPx ?? 0,
      sz: orderWithBuilder.sz,
      reduce_only: orderWithBuilder.reduceOnly,
      order_type: orderWithBuilder.orderType === 'market' ? { market: {} } : { limit: { tif: 'Gtc' } },
      cloid: orderWithBuilder.cloid,
      builder: orderWithBuilder.builder,
    });
  }

  // Update leverage
  async updateLeverage(coin: string, leverage: number, isCross: boolean = true) {
    const client = await this.getClient();
    return client.exchange.updateLeverage({
      coin,
      leverage,
      is_cross: isCross,
    });
  }

  // Update isolated margin
  async updateIsolatedMargin(coin: string, amount: number) {
    const client = await this.getClient();
    return client.exchange.updateIsolatedMargin({
      coin,
      ntli: amount,
    });
  }

  // Get funding history
  async getFundingHistory(coin: string, startTime?: number) {
    const client = await this.getClient();
    return client.info.fundingHistory({ coin, startTime });
  }

  // Get predicted funding rates
  async getPredictedFundingRates() {
    const client = await this.getClient();
    return client.info.predictedFundings();
  }

  // Get historical orders
  async getHistoricalOrders() {
    const client = await this.getClient();
    return client.info.historicalOrders({ user: this.walletAddress });
  }

  // Get user funding
  async getUserFunding() {
    const client = await this.getClient();
    return client.info.userFunding({ user: this.walletAddress });
  }

  // Get portfolio
  async getPortfolio() {
    const client = await this.getClient();
    return client.info.portfolio({ user: this.walletAddress });
  }
}
