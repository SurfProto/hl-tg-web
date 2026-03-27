import type {
  AccountState,
  Fill,
  MarketType,
  OpenOrder,
  Order,
  OrderSide,
  WsMessage,
} from '@repo/types';
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, getBuilderConfig, isBuilderConfigured } from './builder';
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

interface CachedMarket {
  asset: number;
  name: string;
  marketType: MarketType;
  szDecimals: number;
  priceDecimals: number;
  maxLeverage: number;
  aliases: string[];
}

interface MarketCache {
  perp: Record<string, CachedMarket>;
  spot: Record<string, CachedMarket>;
  spotTokenNames: Set<string>;
  spotMarkets: Array<{
    name: string;
    index: number;
    tokens: [number, number];
    baseName: string;
    quoteName: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated: boolean;
    isDelisted: boolean;
  }>;
  perpMarkets: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated: boolean;
    isDelisted: boolean;
    index: number;
  }>;
}

interface NormalizedOrderContext {
  market: CachedMarket;
  price: string;
  size: string;
  reduceOnly: boolean;
  side: OrderSide;
  tif: 'Gtc' | 'Ioc' | 'Alo';
  cloid: `0x${string}`;
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
  private marketCache: MarketCache | null = null;
  private builderApprovalCache = new Map<string, number>();

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

  private async ensureMarketCache(): Promise<MarketCache> {
    if (this.marketCache) return this.marketCache;

    const client = await this.getPublicClient();
    const [spotMeta, metaAndCtxs] = await Promise.all([
      client.spotMeta(),
      client.metaAndAssetCtxs(),
    ]);

    const tokensByIndex: Record<number, any> = {};
    for (const token of spotMeta.tokens) {
      tokensByIndex[token.index] = token;
    }

    const spot: Record<string, CachedMarket> = {};
    const perp: Record<string, CachedMarket> = {};

    const perpMarkets = metaAndCtxs[0].universe
      .filter((market: any) => !market.isDelisted)
      .map((market: any, index: number) => {
        const cached: CachedMarket = {
          asset: index,
          aliases: [market.name],
          marketType: 'perp',
          maxLeverage: market.maxLeverage,
          name: market.name,
          priceDecimals: Math.max(0, 6 - market.szDecimals),
          szDecimals: market.szDecimals,
        };
        perp[market.name.toUpperCase()] = cached;
        return {
          ...market,
          index,
        };
      });

    const spotMarkets = spotMeta.universe.map((pair: any) => {
      const baseToken = tokensByIndex[pair.tokens[0]];
      const quoteToken = tokensByIndex[pair.tokens[1]];
      const aliases = [pair.name, `@${pair.index}`];
      const cached: CachedMarket = {
        asset: 10000 + pair.index,
        aliases,
        marketType: 'spot',
        maxLeverage: 1,
        name: pair.name,
        priceDecimals: Math.max(0, 8 - (baseToken?.szDecimals ?? 0)),
        szDecimals: baseToken?.szDecimals ?? 0,
      };
      for (const alias of aliases) {
        spot[alias.toUpperCase()] = cached;
      }
      return {
        name: pair.name,
        index: pair.index,
        tokens: pair.tokens,
        baseName: baseToken?.name ?? pair.name,
        quoteName: quoteToken?.name ?? 'USDC',
        szDecimals: baseToken?.szDecimals ?? 0,
        maxLeverage: 1,
        onlyIsolated: false,
        isDelisted: false,
      };
    });

    this.marketCache = {
      perp,
      perpMarkets,
      spot,
      spotMarkets,
      spotTokenNames: new Set(spotMeta.tokens.map((token: any) => token.name)) as Set<string>,
    };

    return this.marketCache;
  }

  async resolveMarket(coin: string, marketType?: MarketType): Promise<CachedMarket> {
    const cache = await this.ensureMarketCache();
    const key = coin.toUpperCase();
    const lookups = marketType === 'spot'
      ? [cache.spot[key]]
      : marketType === 'perp'
        ? [cache.perp[key]]
        : [cache.perp[key], cache.spot[key]];

    const resolved = lookups.find(Boolean);
    if (!resolved) throw new Error(`Unknown market: ${coin}`);
    return resolved;
  }

  private stripTrailingZeros(value: string): string {
    if (!value.includes('.')) return value;
    return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '').replace(/\.$/u, '');
  }

  private truncateToDecimals(value: number, decimals: number): string {
    const factor = 10 ** decimals;
    const truncated = Math.trunc((value + Number.EPSILON) * factor) / factor;
    return decimals === 0 ? String(Math.trunc(truncated)) : this.stripTrailingZeros(truncated.toFixed(decimals));
  }

  private limitSignificantFigures(value: string, maxSignificant: number): string {
    let result = '';
    let significantDigits = 0;
    let seenNonZero = false;

    for (const char of value) {
      if (char === '.') {
        if (!result.includes('.')) {
          result += result === '' ? '0.' : '.';
        }
        continue;
      }

      if (!seenNonZero) {
        if (char === '0') {
          result += char;
          continue;
        }
        seenNonZero = true;
      }

      if (significantDigits >= maxSignificant) continue;
      significantDigits += 1;
      result += char;
    }

    return this.stripTrailingZeros(result || '0');
  }

  private formatPrice(rawPrice: number, market: CachedMarket): string {
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      throw new Error(`Invalid price for ${market.name}`);
    }
    const truncated = this.truncateToDecimals(rawPrice, market.priceDecimals);
    const limited = this.limitSignificantFigures(truncated, 5);
    if (limited === '0') throw new Error(`Price rounded to zero for ${market.name}`);
    return limited;
  }

  private formatSize(rawSize: number, market: CachedMarket): string {
    if (!Number.isFinite(rawSize) || rawSize <= 0) {
      throw new Error(`Invalid size for ${market.name}`);
    }
    const formatted = this.truncateToDecimals(rawSize, market.szDecimals);
    if (Number(formatted) <= 0) {
      throw new Error(`Order size is too small for ${market.name}`);
    }
    return formatted;
  }

  private generateCloid(): `0x${string}` {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `0x${hex}`;
  }

  private async getReferencePrice(market: CachedMarket): Promise<number> {
    const mids = await this.getMids();
    for (const alias of market.aliases) {
      const mid = mids?.[alias];
      if (mid != null) return parseFloat(mid);
    }
    throw new Error(`No live market price available for ${market.name}`);
  }

  private getAggressiveMarketPrice(referencePrice: number, side: OrderSide): number {
    const slippageMultiplier = side === 'buy' ? 1.05 : 0.95;
    return referencePrice * slippageMultiplier;
  }

  private async ensureBuilderApproval(): Promise<ReturnType<typeof getBuilderConfig>> {
    const builder = getBuilderConfig();
    if (!builder) return undefined;

    const cachedMaxFee = this.builderApprovalCache.get(BUILDER_ADDRESS.toLowerCase());
    if ((cachedMaxFee ?? 0) > 0) return builder;

    const maxFee = await this.getMaxBuilderFee(BUILDER_ADDRESS);
    if (maxFee <= 0) {
      throw new Error('Builder fee approval is required before trading.');
    }
    return builder;
  }

  private normalizeExchangeError(action: string, context: Record<string, unknown>, error: unknown): never {
    console.error(`[HL] ${action} failed`, context, error);

    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error(`${action} failed`);
  }

  private async ensurePerpLeverage(coin: string, leverage?: number, reduceOnly?: boolean): Promise<void> {
    if (!leverage || leverage <= 0 || reduceOnly) return;

    const userState = await this.getUserState();
    const existingPosition = userState.assetPositions.find((assetPosition) => assetPosition.position.coin === coin)?.position;

    if (
      existingPosition &&
      existingPosition.leverage.type === 'cross' &&
      existingPosition.leverage.value === leverage
    ) {
      return;
    }

    await this.updateLeverage(coin, leverage, true);
  }

  private async normalizeOrder(order: Order): Promise<NormalizedOrderContext> {
    const market = await this.resolveMarket(order.coin, order.marketType);
    const referencePrice = order.orderType === 'limit'
      ? order.limitPx
      : await this.getReferencePrice(market);

    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      throw new Error(`Missing reference price for ${market.name}`);
    }

    const rawPrice = order.orderType === 'market'
      ? this.getAggressiveMarketPrice(referencePrice, order.side)
      : referencePrice;
    const rawSize = order.sizeUsd / referencePrice;

    return {
      cloid: (order.cloid as `0x${string}` | undefined) ?? this.generateCloid(),
      market,
      price: this.formatPrice(rawPrice, market),
      reduceOnly: order.reduceOnly,
      side: order.side,
      size: this.formatSize(rawSize, market),
      tif: order.orderType === 'market' ? 'Ioc' : 'Gtc',
    };
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

  // Get all markets (spot + perp), filtered for tradeable assets
  async getMarkets() {
    const cache = await this.ensureMarketCache();
    return {
      perp: cache.perpMarkets,
      spot: cache.spotMarkets,
      spotTokenNames: cache.spotTokenNames,
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
    const resolved = await this.resolveMarket(coin);
    const raw = await client.l2Book({ coin: resolved.name });
    return {
      coin: raw.coin,
      time: raw.time,
      levels: {
        bids: raw.levels[0].map((level: any) => ({ px: parseFloat(level.px), sz: parseFloat(level.sz), n: level.n })),
        asks: raw.levels[1].map((level: any) => ({ px: parseFloat(level.px), sz: parseFloat(level.sz), n: level.n })),
      },
    };
  }

  // Get candles (last 7 days)
  async getCandles(coin: string, interval: string) {
    const client = await this.getPublicClient();
    const resolved = await this.resolveMarket(coin);
    const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const raw = await client.candleSnapshot({ coin: resolved.name, interval, startTime });
    return raw.map((candle: any) => ({
      t: candle.t,
      T: candle.T,
      s: candle.s,
      i: candle.i,
      o: parseFloat(candle.o),
      h: parseFloat(candle.h),
      l: parseFloat(candle.l),
      c: parseFloat(candle.c),
      v: parseFloat(candle.v),
      n: candle.n,
    }));
  }

  // Get user state
  async getUserState(): Promise<AccountState> {
    const client = await this.getPublicClient();
    const raw = await client.clearinghouseState({ user: this.walletAddress as `0x${string}` });

    const parseMarginSummary = (marginSummary: any) => ({
      accountValue: parseFloat(marginSummary.accountValue),
      totalMarginUsed: parseFloat(marginSummary.totalMarginUsed),
      totalNtlPos: parseFloat(marginSummary.totalNtlPos),
      totalRawUsd: parseFloat(marginSummary.totalRawUsd),
    });

    return {
      marginSummary: parseMarginSummary(raw.marginSummary),
      crossMarginSummary: parseMarginSummary(raw.crossMarginSummary),
      crossMaintenanceMarginUsed: parseFloat(raw.crossMaintenanceMarginUsed),
      withdrawable: parseFloat(raw.withdrawable),
      assetPositions: (raw.assetPositions ?? []).map((assetPosition: any) => ({
        type: assetPosition.type,
        position: {
          coin: assetPosition.position.coin,
          szi: parseFloat(assetPosition.position.szi),
          leverage: {
            type: assetPosition.position.leverage.type,
            value: parseFloat(assetPosition.position.leverage.value),
          },
          entryPx: parseFloat(assetPosition.position.entryPx),
          liquidationPx: assetPosition.position.liquidationPx != null
            ? parseFloat(assetPosition.position.liquidationPx)
            : null,
          marginUsed: parseFloat(assetPosition.position.marginUsed),
          maxLeverage: parseFloat(assetPosition.position.maxLeverage),
          positionValue: parseFloat(assetPosition.position.positionValue),
          returnOnEquity: parseFloat(assetPosition.position.returnOnEquity),
          unrealizedPnl: parseFloat(assetPosition.position.unrealizedPnl),
        },
      })),
    };
  }

  // Get open orders
  async getOpenOrders(): Promise<OpenOrder[]> {
    const client = await this.getPublicClient();
    const rawOrders = await client.frontendOpenOrders({ user: this.walletAddress as `0x${string}` });
    return rawOrders.map((order: any) => ({
      oid: order.oid,
      coin: order.coin,
      side: order.side === 'B' ? 'buy' : 'sell',
      limitPx: parseFloat(order.limitPx),
      sz: parseFloat(order.sz),
      timestamp: order.timestamp,
      orderType: order.orderType === 'Limit' ? 'limit' : 'market',
      reduceOnly: Boolean(order.reduceOnly),
      tif: order.tif ?? null,
      triggerPx: order.triggerPx ? parseFloat(order.triggerPx) : null,
      isTrigger: Boolean(order.isTrigger),
      cloid: order.cloid ?? null,
    }));
  }

  // Get fills
  async getFills(): Promise<Fill[]> {
    const client = await this.getPublicClient();
    const rawFills = await client.userFills({ user: this.walletAddress as `0x${string}` });
    return rawFills.map((fill: any) => ({
      closedPnl: parseFloat(fill.closedPnl),
      coin: fill.coin,
      crossed: fill.crossed,
      dir: fill.dir,
      fee: parseFloat(fill.fee),
      feeToken: fill.feeToken,
      hash: fill.hash,
      oid: fill.oid,
      px: parseFloat(fill.px),
      side: fill.side === 'B' ? 'buy' : 'sell',
      startPosition: parseFloat(fill.startPosition),
      sz: parseFloat(fill.sz),
      tid: fill.tid,
      time: fill.time,
      cloid: fill.cloid ?? null,
    }));
  }

  async placeOrder(order: Order) {
    try {
      const client = await this.getWalletClient();
      const normalized = await this.normalizeOrder({
        ...order,
        marketType: order.marketType ?? 'perp',
      });

      if (normalized.market.marketType !== 'perp') {
        throw new Error(`Use spot order flow for ${normalized.market.name}`);
      }

      await this.ensurePerpLeverage(normalized.market.name, order.leverage, order.reduceOnly);
      const builder = await this.ensureBuilderApproval();

      return client.order({
        orders: [{
          a: normalized.market.asset,
          b: normalized.side === 'buy',
          p: normalized.price,
          s: normalized.size,
          r: normalized.reduceOnly,
          t: { limit: { tif: normalized.tif } },
          c: normalized.cloid,
        }],
        grouping: 'na',
        builder,
      });
    } catch (error) {
      this.normalizeExchangeError('placeOrder', {
        coin: order.coin,
        leverage: order.leverage,
        marketType: order.marketType ?? 'perp',
        orderType: order.orderType,
        reduceOnly: order.reduceOnly,
        sizeUsd: order.sizeUsd,
      }, error);
    }
  }

  async closePosition(coin: string) {
    try {
      const client = await this.getWalletClient();
      const market = await this.resolveMarket(coin, 'perp');
      const userState = await this.getUserState();
      const position = userState.assetPositions.find((assetPosition) => assetPosition.position.coin === market.name)?.position;

      if (!position || position.szi === 0) {
        throw new Error(`No open position for ${coin}`);
      }

      const referencePrice = await this.getReferencePrice(market).catch(() => position.entryPx);
      const side: OrderSide = position.szi > 0 ? 'sell' : 'buy';
      const rawPrice = this.getAggressiveMarketPrice(referencePrice, side);
      const builder = await this.ensureBuilderApproval();

      return client.order({
        orders: [{
          a: market.asset,
          b: side === 'buy',
          p: this.formatPrice(rawPrice, market),
          s: this.formatSize(Math.abs(position.szi), market),
          r: true,
          t: { limit: { tif: 'Ioc' } },
          c: this.generateCloid(),
        }],
        grouping: 'na',
        builder,
      });
    } catch (error) {
      this.normalizeExchangeError('closePosition', { coin }, error);
    }
  }

  // Cancel order
  async cancelOrder(coin: string, oid: number) {
    try {
      const client = await this.getWalletClient();
      const market = await this.resolveMarket(coin);
      return client.cancel({
        cancels: [{ a: market.asset, o: oid }],
      });
    } catch (error) {
      this.normalizeExchangeError('cancelOrder', { coin, oid }, error);
    }
  }

  // Cancel all orders (optionally for a specific coin)
  async cancelAllOrders(coin?: string) {
    try {
      const client = await this.getWalletClient();
      const openOrders = await this.getOpenOrders();
      const toCancel = coin
        ? openOrders.filter((openOrder) => openOrder.coin === coin)
        : openOrders;

      if (toCancel.length === 0) return;

      const cancels = await Promise.all(
        toCancel.map(async (openOrder) => {
          const market = await this.resolveMarket(openOrder.coin);
          return {
            a: market.asset,
            o: openOrder.oid,
          };
        }),
      );

      return client.cancel({ cancels });
    } catch (error) {
      this.normalizeExchangeError('cancelAllOrders', { coin }, error);
    }
  }

  // Modify order
  async modifyOrder(oid: number, order: Order) {
    try {
      const client = await this.getWalletClient();
      const normalized = await this.normalizeOrder(order);
      return client.modify({
        oid,
        order: {
          a: normalized.market.asset,
          b: normalized.side === 'buy',
          p: normalized.price,
          s: normalized.size,
          r: normalized.reduceOnly,
          t: { limit: { tif: normalized.tif } },
          c: normalized.cloid,
        },
      });
    } catch (error) {
      this.normalizeExchangeError('modifyOrder', {
        coin: order.coin,
        oid,
        orderType: order.orderType,
        sizeUsd: order.sizeUsd,
      }, error);
    }
  }

  // Update leverage
  async updateLeverage(coin: string, leverage: number, isCross: boolean = true) {
    try {
      const client = await this.getWalletClient();
      const market = await this.resolveMarket(coin, 'perp');
      return client.updateLeverage({
        asset: market.asset,
        isCross,
        leverage,
      });
    } catch (error) {
      this.normalizeExchangeError('updateLeverage', { coin, leverage, isCross }, error);
    }
  }

  // Update isolated margin
  async updateIsolatedMargin(coin: string, amount: number) {
    try {
      const client = await this.getWalletClient();
      const market = await this.resolveMarket(coin, 'perp');
      return client.updateIsolatedMargin({
        asset: market.asset,
        isBuy: true,
        ntli: amount,
      });
    } catch (error) {
      this.normalizeExchangeError('updateIsolatedMargin', { amount, coin }, error);
    }
  }

  // Get funding history
  async getFundingHistory(coin: string, startTime?: number) {
    const client = await this.getPublicClient();
    const resolved = await this.resolveMarket(coin, 'perp');
    return client.fundingHistory({
      coin: resolved.name,
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

  // Place a spot order (also used for USDC-USDH swap)
  async placeSpotOrder(order: Order) {
    try {
      const client = await this.getWalletClient();
      const normalized = await this.normalizeOrder({
        ...order,
        marketType: 'spot',
      });
      const builder = await this.ensureBuilderApproval();

      return client.order({
        orders: [{
          a: normalized.market.asset,
          b: normalized.side === 'buy',
          p: normalized.price,
          s: normalized.size,
          r: false,
          t: { limit: { tif: normalized.tif } },
          c: normalized.cloid,
        }],
        grouping: 'na',
        builder,
      });
    } catch (error) {
      this.normalizeExchangeError('placeSpotOrder', {
        coin: order.coin,
        orderType: order.orderType,
        sizeUsd: order.sizeUsd,
      }, error);
    }
  }

  // Approve builder fee for this user
  async approveBuilderFee(builder: string, maxFeeRate: string) {
    try {
      const client = await this.getWalletClient();
      const response = await client.approveBuilderFee({
        builder: builder as `0x${string}`,
        maxFeeRate: maxFeeRate as `${string}%`,
      });
      this.builderApprovalCache.set(builder.toLowerCase(), BUILDER_FEE_TENTHS_BP);
      return response;
    } catch (error) {
      this.normalizeExchangeError('approveBuilderFee', { builder, maxFeeRate }, error);
    }
  }

  // Check max approved builder fee for this user
  async getMaxBuilderFee(builder: string): Promise<number> {
    const client = await this.getPublicClient();
    const maxFee = await client.maxBuilderFee({
      user: this.walletAddress as `0x${string}`,
      builder: builder as `0x${string}`,
    });
    this.builderApprovalCache.set(builder.toLowerCase(), maxFee);
    return maxFee;
  }

  getBuilderStatus() {
    return {
      configured: isBuilderConfigured(),
      feeTenthsBp: isBuilderConfigured() ? getBuilderConfig()?.f ?? 0 : 0,
    };
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
