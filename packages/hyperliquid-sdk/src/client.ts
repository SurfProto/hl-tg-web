import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  AccountState,
  AssetCtx,
  Fill,
  MarketStats,
  MarketType,
  OpenOrder,
  Order,
  OrderSide,
  OrderValidationResult,
  PortfolioHistoryPoint,
  WsMessage,
} from '@repo/types';
import { BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP, getBuilderConfig, isBuilderConfigured } from './builder';
import { formatOrderSize, validateOrderInput } from './order-validation';
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
  baseCoin: string;
  marketType: MarketType;
  szDecimals: number;
  priceDecimals: number;
  maxLeverage: number;
  aliases: string[];
  minNotionalUsd: number;
  minBaseSize: number;
  dex?: string;
  dexIndex?: number;
  isHip3?: boolean;
  onlyIsolated?: boolean;
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
    minNotionalUsd: number;
    minBaseSize: number;
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
    minNotionalUsd: number;
    minBaseSize: number;
    dex?: string;
    dexIndex?: number;
    isHip3?: boolean;
  }>;
  perpDexs: Array<{
    dex: string;
    dexIndex: number;
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
  debug?: {
    allMidPrice: number | null;
    bestAsk: number | null;
    bestBid: number | null;
    executionSource: 'book' | 'mid';
    formattedPrice: string;
    markPrice: number | null;
    oraclePrice: number | null;
    rawExecutionPrice: number;
    referencePrice: number;
  };
}

export interface HyperliquidClientConfig {
  walletAddress?: string;
  masterAccountAddress?: string;
  customSigner?: unknown;
  testnet?: boolean;
}

const MIN_ORDER_NOTIONAL_USD = 10;

export class HyperliquidClient {
  private publicClientInstance: any = null;
  private walletClientInstance: any = null;
  private agentWalletClientInstance: any = null;
  private agentPrivateKey: `0x${string}` | null = null;
  private wsManager: WebSocketManager;
  private walletAddress: string;
  private testnet: boolean;
  private config: HyperliquidClientConfig;
  private marketCache: MarketCache | null = null;
  private assetCtxsCache: { data: any[]; perpUniverse: any[]; timestamp: number } | null = null;
  private builderApprovalCache = new Map<string, number>();
  private leverageTypeCache = new Map<string, boolean>();

  constructor(config: HyperliquidClientConfig) {
    this.walletAddress = config.masterAccountAddress ?? config.walletAddress ?? '';
    this.testnet = config.testnet ?? false;
    this.config = {
      ...config,
      masterAccountAddress: config.masterAccountAddress ?? config.walletAddress,
    };
    this.wsManager = new WebSocketManager(this.testnet);
  }

  private getHttpApiUrl(): string {
    return this.testnet
      ? 'https://api.hyperliquid-testnet.xyz'
      : 'https://api.hyperliquid.xyz';
  }

  private async postInfo<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.getHttpApiUrl()}/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Info request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
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

  // Main wallet client — uses the Privy signer. Only for setup actions (approveAgent, approveBuilderFee).
  private async getMainWalletClient() {
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

  // Trading client — uses agent wallet when available, otherwise falls back to main.
  private async getTradingClient() {
    if (this.agentPrivateKey && !this.agentWalletClientInstance) {
      const SDK = await loadHyperliquidSDK();
      const account = privateKeyToAccount(this.agentPrivateKey);
      const apiUrl = this.getHttpApiUrl();
      const viemWallet = createWalletClient({ account, transport: http(apiUrl) });
      const transport = new SDK.HttpTransport({ url: apiUrl });
      this.agentWalletClientInstance = new SDK.WalletClient({
        defaultVaultAddress: this.walletAddress ? this.walletAddress as `0x${string}` : undefined,
        transport,
        wallet: viemWallet,
        isTestnet: this.testnet,
      });
    }
    if (this.agentWalletClientInstance) return this.agentWalletClientInstance;
    return this.getMainWalletClient();
  }

  // Fund-movement and account-level actions must execute as the main wallet user.
  private async getFundsClient() {
    return this.getMainWalletClient();
  }

  // Set an agent private key so all trading actions sign silently without Privy prompts.
  setAgentKey(privateKey: `0x${string}`) {
    this.agentPrivateKey = privateKey;
    this.agentWalletClientInstance = null; // recreated lazily on next getTradingClient call
  }

  hasAgentKey(): boolean {
    return this.agentPrivateKey !== null;
  }

  private async ensureMarketCache(): Promise<MarketCache> {
    if (this.marketCache) return this.marketCache;

    const client = await this.getPublicClient();
    const [spotMeta, metaAndCtxs, perpDexsResponse] = await Promise.all([
      client.spotMeta(),
      this.postInfo<any>( { type: 'metaAndAssetCtxs' } ),
      this.postInfo<Array<{ name: string } | null>>({ type: 'perpDexs' }).catch(() => [null]),
    ]);

    // Cache asset contexts (index [1]) for getMarketStats/getAssetCtx — normally discarded
    if (metaAndCtxs[1]) {
      this.assetCtxsCache = {
        data: metaAndCtxs[1],
        perpUniverse: metaAndCtxs[0].universe,
        timestamp: Date.now(),
      };
    }

    const tokensByIndex: Record<number, any> = {};
    for (const token of spotMeta.tokens) {
      tokensByIndex[token.index] = token;
    }

    const spot: Record<string, CachedMarket> = {};
    const perp: Record<string, CachedMarket> = {};
    const perpDexs = perpDexsResponse
      .map((entry, dexIndex) => entry ? { dex: entry.name, dexIndex } : null)
      .filter(Boolean) as Array<{ dex: string; dexIndex: number }>;

    const perpMarkets = metaAndCtxs[0].universe
      .filter((market: any) => !market.isDelisted)
      .map((market: any, index: number) => {
        const cached: CachedMarket = {
          asset: index,
          aliases: [market.name],
          baseCoin: market.name,
          dex: undefined,
          dexIndex: 0,
          isHip3: false,
          marketType: 'perp',
          maxLeverage: market.maxLeverage,
          minBaseSize: 10 ** (-market.szDecimals),
          minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
          name: market.name,
          onlyIsolated: Boolean(market.onlyIsolated),
          priceDecimals: Math.max(0, 6 - market.szDecimals),
          szDecimals: market.szDecimals,
        };
        perp[market.name.toUpperCase()] = cached;
        return {
          ...market,
          index,
          onlyIsolated: Boolean(market.onlyIsolated),
          minBaseSize: cached.minBaseSize,
          minNotionalUsd: cached.minNotionalUsd,
        };
      });

    const hip3PerpMarkets = (
      await Promise.all(
        perpDexs.map(async ({ dex, dexIndex }) => {
          const dexMetaAndCtxs = await this.postInfo<any>({
            type: 'metaAndAssetCtxs',
            dex,
          });

          return dexMetaAndCtxs[0].universe
            .filter((market: any) => !market.isDelisted)
            .map((market: any, index: number) => {
              const fullName = `${dex}:${market.name}`;
              const cached: CachedMarket = {
                asset: 100000 + dexIndex * 10000 + index,
                aliases: [fullName],
                baseCoin: market.name,
                dex,
                dexIndex,
                isHip3: true,
                marketType: 'perp',
                maxLeverage: market.maxLeverage,
                minBaseSize: 10 ** (-market.szDecimals),
                minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
                name: fullName,
                onlyIsolated: Boolean(market.onlyIsolated),
                priceDecimals: Math.max(0, 6 - market.szDecimals),
                szDecimals: market.szDecimals,
              };
              perp[fullName.toUpperCase()] = cached;
              return {
                ...market,
                dex,
                dexIndex,
                index,
                isHip3: true,
                maxLeverage: market.maxLeverage,
                minBaseSize: cached.minBaseSize,
                minNotionalUsd: cached.minNotionalUsd,
                name: fullName,
                onlyIsolated: Boolean(market.onlyIsolated),
              };
            });
        }),
      )
    ).flat();

    const spotMarkets = spotMeta.universe.map((pair: any) => {
      const baseToken = tokensByIndex[pair.tokens[0]];
      const quoteToken = tokensByIndex[pair.tokens[1]];
      const aliases = [pair.name, `@${pair.index}`];
      const cached: CachedMarket = {
        asset: 10000 + pair.index,
        aliases,
        baseCoin: baseToken?.name ?? pair.name,
        marketType: 'spot',
        maxLeverage: 1,
        minBaseSize: 10 ** (-(baseToken?.szDecimals ?? 0)),
        minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
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
        minBaseSize: cached.minBaseSize,
        minNotionalUsd: cached.minNotionalUsd,
        onlyIsolated: false,
        isDelisted: false,
      };
    });

    this.marketCache = {
      perp,
      perpDexs,
      perpMarkets: [...perpMarkets, ...hip3PerpMarkets],
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
    return formatOrderSize(rawSize, market);
  }

  private getOrderValidation(
    order: Order,
    market: CachedMarket,
    referencePrice: number,
    availableBalance?: number,
  ): OrderValidationResult {
    return validateOrderInput(order, market, referencePrice, availableBalance);
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

  private async getMarketOrderExecutionContext(market: CachedMarket, side: OrderSide) {
    const mids = await this.getMids().catch(() => null);
    let allMidPrice: number | null = null;

    if (mids) {
      for (const alias of market.aliases) {
        const mid = mids[alias];
        if (mid != null) {
          allMidPrice = parseFloat(mid);
          break;
        }
      }
    }

    let bestBid: number | null = null;
    let bestAsk: number | null = null;
    try {
      const orderbook = await this.getOrderbook(market.name);
      bestBid = orderbook.levels.bids[0]?.px ?? null;
      bestAsk = orderbook.levels.asks[0]?.px ?? null;
    } catch {
      // Best effort only — we can still fall back to mids.
    }

    let markPrice: number | null = null;
    let oraclePrice: number | null = null;
    try {
      const assetCtx = await this.getAssetCtx(market.baseCoin);
      markPrice = assetCtx?.markPx ?? null;
      oraclePrice = assetCtx?.oraclePx ?? null;
    } catch {
      // Asset context is not guaranteed for every market class.
    }

    const bookAnchor = side === 'buy' ? bestAsk : bestBid;
    const referencePrice = bookAnchor ?? allMidPrice;
    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      throw new Error(`No executable market price available for ${market.name}`);
    }

    const rawExecutionPrice = bookAnchor != null
      ? referencePrice
      : this.getAggressiveMarketPrice(referencePrice, side);

    return {
      allMidPrice,
      bestAsk,
      bestBid,
      executionSource: bookAnchor != null ? 'book' as const : 'mid' as const,
      markPrice,
      oraclePrice,
      rawExecutionPrice,
      referencePrice,
    };
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
      const lowerMessage = error.message.toLowerCase();
      const isTradingAction = [
        'cancelAllOrders',
        'cancelOrder',
        'closePosition',
        'modifyOrder',
        'placeOrder',
        'placeSpotOrder',
        'updateIsolatedMargin',
        'updateLeverage',
      ].includes(action);

      if (isTradingAction && lowerMessage.includes('must deposit before performing actions')) {
        throw new Error('Trading agent is not linked to a funded Hyperliquid account. Re-run trading setup or deposit funds into your main account.');
      }
      if (action === 'usdClassTransfer' && lowerMessage.includes('must deposit before performing actions')) {
        throw new Error('Transfer unavailable until your main Hyperliquid account has a deposit. Deposit funds first, then try again.');
      }
      if (
        (action === 'placeOrder' || action === 'placeSpotOrder' || action === 'closePosition') &&
        lowerMessage.includes('order price cannot be more than 95% away from the reference price')
      ) {
        throw new Error('Market too illiquid for a market order right now. Try a limit order.');
      }
      throw new Error(error.message);
    }
    throw new Error(`${action} failed`);
  }

  private unwrapStatuses(response: any) {
    const statuses = response?.response?.data?.statuses;
    if (!Array.isArray(statuses)) {
      return response;
    }

    const errorStatus = statuses.find((status: any) => status?.error);
    if (errorStatus?.error) {
      throw new Error(errorStatus.error);
    }

    return response;
  }

  private isRetryableLeverageError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes('invalid leverage value')
      || (message.includes('leverage') && message.includes('invalid'))
      || (message.includes('margin') && (message.includes('cross') || message.includes('isolated')));
  }

  private async ensurePerpLeverage(market: CachedMarket, leverage?: number, reduceOnly?: boolean): Promise<void> {
    if (!leverage || leverage <= 0 || reduceOnly) return;

    const userState = await this.getUserState();
    const existingPosition = userState.assetPositions.find((assetPosition) => assetPosition.position.coin === market.name)?.position;
    const cachedLeverageType = this.leverageTypeCache.get(market.name);
    const isCross = existingPosition
      ? existingPosition.leverage.type === 'cross'
      : cachedLeverageType ?? true;

    if (
      existingPosition &&
      existingPosition.leverage.type === (isCross ? 'cross' : 'isolated') &&
      existingPosition.leverage.value === leverage
    ) {
      this.leverageTypeCache.set(market.name, isCross);
      return;
    }

    try {
      await this.updateLeverage(market.name, leverage, isCross);
      this.leverageTypeCache.set(market.name, isCross);
    } catch (error) {
      if (!this.isRetryableLeverageError(error) || existingPosition) {
        throw error;
      }

      const fallbackIsCross = !isCross;
      await this.updateLeverage(market.name, leverage, fallbackIsCross);
      this.leverageTypeCache.set(market.name, fallbackIsCross);
    }
  }

  private async normalizeOrder(order: Order): Promise<NormalizedOrderContext> {
    const market = await this.resolveMarket(order.coin, order.marketType);
    const executionContext = order.orderType === 'market'
      ? await this.getMarketOrderExecutionContext(market, order.side)
      : null;
    const referencePrice = order.orderType === 'limit'
      ? order.limitPx
      : executionContext?.referencePrice ?? await this.getReferencePrice(market);

    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      throw new Error(`Missing reference price for ${market.name}`);
    }

    const validation = this.getOrderValidation(order, market, referencePrice);
    if (!validation.isValid) {
      throw new Error(validation.reason ?? 'Order validation failed.');
    }

    const rawPrice = order.orderType === 'market'
      ? executionContext?.rawExecutionPrice ?? this.getAggressiveMarketPrice(referencePrice, order.side)
      : referencePrice;
    const rawSize = order.sizeUsd / referencePrice;
    const formattedPrice = this.formatPrice(rawPrice, market);

    return {
      cloid: (order.cloid as `0x${string}` | undefined) ?? this.generateCloid(),
      debug: executionContext ? {
        ...executionContext,
        formattedPrice,
      } : undefined,
      market,
      price: formattedPrice,
      reduceOnly: order.reduceOnly,
      side: order.side,
      size: this.formatSize(rawSize, market),
      tif: (order.tif as 'Gtc' | 'Ioc' | 'Alo') ?? (order.orderType === 'market' ? 'Ioc' : 'Gtc'),
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

  onWsStatusChange(cb: (connected: boolean) => void): () => void {
    return this.wsManager.onStatusChange(cb);
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

  async validateOrder(
    order: Order,
    options?: { availableBalance?: number; referencePrice?: number },
  ): Promise<OrderValidationResult> {
    const market = await this.resolveMarket(order.coin, order.marketType);
    const referencePrice = options?.referencePrice
      ?? order.limitPx
      ?? await this.getReferencePrice(market);

    return this.getOrderValidation(order, market, referencePrice, options?.availableBalance);
  }

  // Get market prices
  async getMids() {
    const cache = await this.ensureMarketCache();
    const [baseMids, ...dexMids] = await Promise.all([
      this.postInfo<Record<string, string>>({ type: 'allMids' }),
      ...cache.perpDexs.map(({ dex }) =>
        this.postInfo<Record<string, string>>({ type: 'allMids', dex })
          .then((mids) => ({ dex, mids })),
      ),
    ]);

    const merged = { ...baseMids };
    for (const dexResult of dexMids) {
      Object.entries(dexResult.mids).forEach(([coin, price]) => {
        merged[`${dexResult.dex}:${coin}`] = price;
      });
    }
    return merged;
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
    const cache = await this.ensureMarketCache();
    const [baseState, ...dexStates] = await Promise.all([
      this.postInfo<any>({
        type: 'clearinghouseState',
        user: this.walletAddress as `0x${string}`,
      }),
      ...cache.perpDexs.map(({ dex }) =>
        this.postInfo<any>({
          type: 'clearinghouseState',
          dex,
          user: this.walletAddress as `0x${string}`,
        }),
      ),
    ]);

    const parseMarginSummary = (marginSummary: any) => ({
      accountValue: parseFloat(marginSummary.accountValue),
      totalMarginUsed: parseFloat(marginSummary.totalMarginUsed),
      totalNtlPos: parseFloat(marginSummary.totalNtlPos),
      totalRawUsd: parseFloat(marginSummary.totalRawUsd),
    });

    const allStates = [
      { dex: undefined, state: baseState },
      ...dexStates.map((state, index) => ({ dex: cache.perpDexs[index]?.dex, state })),
    ];

    return {
      marginSummary: parseMarginSummary(baseState.marginSummary),
      crossMarginSummary: parseMarginSummary(baseState.crossMarginSummary),
      crossMaintenanceMarginUsed: parseFloat(baseState.crossMaintenanceMarginUsed),
      withdrawable: parseFloat(baseState.withdrawable),
      assetPositions: allStates.flatMap(({ dex, state }) => (state.assetPositions ?? []).map((assetPosition: any) => ({
        type: assetPosition.type,
        position: {
          coin: dex && !assetPosition.position.coin.includes(':')
            ? `${dex}:${assetPosition.position.coin}`
            : assetPosition.position.coin,
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
      }))),
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
    let normalized: NormalizedOrderContext | undefined;
    try {
      const client = await this.getTradingClient();
      normalized = await this.normalizeOrder({
        ...order,
        marketType: order.marketType ?? 'perp',
      });

      if (normalized.market.marketType !== 'perp') {
        throw new Error(`Use spot order flow for ${normalized.market.name}`);
      }

      await this.ensurePerpLeverage(normalized.market, order.leverage, order.reduceOnly);
      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(await client.order({
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
      }));
    } catch (error) {
      this.normalizeExchangeError('placeOrder', {
        coin: order.coin,
        leverage: order.leverage,
        marketType: order.marketType ?? 'perp',
        orderType: order.orderType,
        reduceOnly: order.reduceOnly,
        sizeUsd: order.sizeUsd,
        pricing: normalized?.debug,
      }, error);
    }
  }

  async closePosition(coin: string) {
    let executionContext: NormalizedOrderContext['debug'] | undefined;
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(coin, 'perp');
      const userState = await this.getUserState();
      const position = userState.assetPositions.find((assetPosition) => assetPosition.position.coin === market.name)?.position;

      if (!position || position.szi === 0) {
        throw new Error(`No open position for ${coin}`);
      }

      const side: OrderSide = position.szi > 0 ? 'sell' : 'buy';
      const marketExecution = await this.getMarketOrderExecutionContext(market, side);
      const formattedPrice = this.formatPrice(marketExecution.rawExecutionPrice, market);
      executionContext = {
        ...marketExecution,
        formattedPrice,
      };
      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(await client.order({
        orders: [{
          a: market.asset,
          b: side === 'buy',
          p: formattedPrice,
          s: this.formatSize(Math.abs(position.szi), market),
          r: true,
          t: { limit: { tif: 'Ioc' } },
          c: this.generateCloid(),
        }],
        grouping: 'na',
        builder,
      }));
    } catch (error) {
      this.normalizeExchangeError('closePosition', {
        coin,
        pricing: executionContext,
      }, error);
    }
  }

  // Cancel order
  async cancelOrder(coin: string, oid: number) {
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(coin);
      return this.unwrapStatuses(await client.cancel({
        cancels: [{ a: market.asset, o: oid }],
      }));
    } catch (error) {
      this.normalizeExchangeError('cancelOrder', { coin, oid }, error);
    }
  }

  // Cancel all orders (optionally for a specific coin)
  async cancelAllOrders(coin?: string) {
    try {
      const client = await this.getTradingClient();
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

      return this.unwrapStatuses(await client.cancel({ cancels }));
    } catch (error) {
      this.normalizeExchangeError('cancelAllOrders', { coin }, error);
    }
  }

  // Modify order
  async modifyOrder(oid: number, order: Order) {
    try {
      const client = await this.getTradingClient();
      const normalized = await this.normalizeOrder(order);
      return this.unwrapStatuses(await client.modify({
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
      }));
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
      const client = await this.getTradingClient();
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
      const client = await this.getTradingClient();
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
    const resolved = await this.resolveMarket(coin, 'perp');
    if (resolved.dex) {
      return this.postInfo<any>({
        type: 'fundingHistory',
        coin: resolved.name,
        dex: resolved.dex,
        startTime: startTime ?? Date.now() - 7 * 24 * 60 * 60 * 1000,
      });
    }

    const client = await this.getPublicClient();
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
    let normalized: NormalizedOrderContext | undefined;
    try {
      const client = await this.getTradingClient();
      normalized = await this.normalizeOrder({
        ...order,
        marketType: 'spot',
      });
      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(await client.order({
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
      }));
    } catch (error) {
      this.normalizeExchangeError('placeSpotOrder', {
        coin: order.coin,
        orderType: order.orderType,
        sizeUsd: order.sizeUsd,
        pricing: normalized?.debug,
      }, error);
    }
  }

  // Approve agent wallet to act on behalf of this user
  async approveAgent(agentAddress: string) {
    try {
      const client = await this.getMainWalletClient();
      return client.approveAgent({
        agentAddress: agentAddress as `0x${string}`,
        agentName: 'HL TG App',
      });
    } catch (error) {
      this.normalizeExchangeError('approveAgent', { agentAddress }, error);
    }
  }

  // Approve builder fee for this user
  async approveBuilderFee(builder: string, maxFeeRate: string) {
    try {
      const client = await this.getMainWalletClient();
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

  // Refresh asset contexts cache (30-second TTL, independent of market metadata)
  private async refreshAssetCtxs(): Promise<void> {
    const ASSET_CTX_TTL_MS = 30_000;
    if (this.assetCtxsCache && Date.now() - this.assetCtxsCache.timestamp < ASSET_CTX_TTL_MS) {
      return;
    }
    const metaAndCtxs = await this.postInfo<any>({ type: 'metaAndAssetCtxs' });
    this.assetCtxsCache = {
      data: metaAndCtxs[1],
      perpUniverse: metaAndCtxs[0].universe,
      timestamp: Date.now(),
    };
  }

  // Get market stats for all perp assets (24h vol, price change, OI, funding)
  async getMarketStats(): Promise<Record<string, MarketStats>> {
    await this.refreshAssetCtxs();
    const { data, perpUniverse } = this.assetCtxsCache!;
    const result: Record<string, MarketStats> = {};

    for (let i = 0; i < perpUniverse.length; i++) {
      const meta = perpUniverse[i];
      const ctx = data[i];
      if (!ctx || meta.isDelisted) continue;

      const markPx = parseFloat(ctx.markPx ?? '0');
      const prevDayPx = parseFloat(ctx.prevDayPx ?? '0');
      const change24h = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;

      result[meta.name] = {
        coin: meta.name,
        markPx,
        prevDayPx,
        dayNtlVlm: parseFloat(ctx.dayNtlVlm ?? '0'),
        openInterest: parseFloat(ctx.openInterest ?? '0'),
        funding: parseFloat(ctx.funding ?? '0'),
        oraclePx: parseFloat(ctx.oraclePx ?? '0'),
        change24h,
      };
    }

    return result;
  }

  // Get asset context for a single coin (OI, funding, 24h vol, mark price)
  async getAssetCtx(coin: string): Promise<AssetCtx | null> {
    const stats = await this.getMarketStats();
    return stats[coin] ?? null;
  }

  // Get portfolio value history for area chart
  async getPortfolioHistory(period: '1d' | '7d' | '30d' = '7d'): Promise<PortfolioHistoryPoint[]> {
    const client = await this.getPublicClient();
    const portfolio = await client.portfolio({ user: this.walletAddress as `0x${string}` });

    // The portfolio response may contain pnlHistory or similar time-series data.
    // Inspect and extract what's available.
    if (Array.isArray(portfolio)) {
      // Portfolio returns an array of snapshots — map to {time, value}
      const now = Date.now();
      const periodMs = period === '1d' ? 86400000 : period === '7d' ? 604800000 : 2592000000;
      const cutoff = now - periodMs;

      return portfolio
        .filter((point: any) => {
          const t = point.time ?? point.t ?? point.timestamp ?? 0;
          return t >= cutoff;
        })
        .map((point: any) => ({
          time: point.time ?? point.t ?? point.timestamp ?? 0,
          value: parseFloat(point.accountValue ?? point.value ?? point.equity ?? '0'),
        }));
    }

    // Fallback: if portfolio is a single object or has a different shape,
    // return current snapshot as a single point
    const userState = await this.getUserState();
    const accountValue = userState?.marginSummary?.accountValue ?? 0;
    return [{ time: Date.now(), value: accountValue }];
  }

  // Get spot account balance (HL L1 spot)
  async getSpotBalance() {
    const client = await this.getPublicClient();
    return client.spotClearinghouseState({ user: this.walletAddress as `0x${string}` });
  }

  // Transfer USDC between Perps and Spot accounts on HL L1
  async usdClassTransfer(amount: string, toPerp: boolean) {
    const client = await this.getFundsClient();
    return client.usdClassTransfer({ amount, toPerp });
  }

  // Withdraw USDC from HL L1 to Arbitrum address (must be signed by main wallet, not agent)
  async withdraw(destination: string, amount: string) {
    const client = await this.getFundsClient();
    return client.withdraw3({ destination: destination as `0x${string}`, amount });
  }
}
