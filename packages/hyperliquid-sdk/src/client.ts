import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
// By path, not by package name: @repo/types resolves through its package.json
// "main", which points at src/index.ts — a specifier Node cannot require once
// Vercel has compiled the tree to .js. Every other import of this package in
// the server graph is `import type`, which compiles away; this constant is the
// only value, so it is the only one that has to resolve at runtime.
import { APP_TRADE_CLOID_PREFIX } from "../../types/src/index";
import type {
  AccountState,
  AccountAbstractionMode,
  AssetCtx,
  Fill,
  MarketStats,
  MarketType,
  OpenOrder,
  Order,
  OrderSide,
  OrderValidationResult,
  PortfolioHistoryPoint,
  PositionProtectionRequest,
  PortfolioPeriodData,
  PortfolioRange,
  StableBalanceState,
  StableSwapAsset,
  TriggerOrderKind,
  TriggerOrderRequest,
  WsMessage,
} from "@repo/types";
import {
  buildAccountState,
  getAvailableCollateralForMarket,
} from "./account-state";
import {
  AgentAuthorizationError,
  findStatusError,
  isRateLimitError,
  isRetryableLeverageError,
  isTradingAction,
  isUnknownSignerMessage,
  isUserRejectedSignature,
  mapExchangeErrorMessage,
} from "./exchange-response";
import {
  AGENT_APPROVAL_WINDOW_MS,
  buildAgentName,
  clearStoredAgentKey,
  generateAgentKey,
  getAgentAddress,
  isTsunamiAgentName,
} from "./agent";
import { reportAgentRecoveryIncident } from "./agent-recovery";
import {
  TRIGGER_ORDER_SLIPPAGE,
  formatPrice,
  getAggressiveMarketPrice,
  orderbookMidpoint,
  parsePositiveNumber,
} from "./order-price";
import { planPositionProtection } from "./position-protection";
import {
  getBuilderAddress,
  getBuilderConfig,
  isBuilderConfigured,
} from "./builder";
import { formatOrderSize, validateOrderInput } from "./order-validation";
import { WebSocketManager } from "./ws";

// Dynamic import for Hyperliquid SDK
let HyperliquidSDK: any = null;
let HyperliquidSigning: any = null;

async function ensureNodeWebSocketGlobal() {
  if (typeof globalThis.WebSocket !== "undefined") {
    return;
  }

  const { WebSocket } = await import("ws");
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocket as unknown as typeof globalThis.WebSocket,
    configurable: true,
    writable: true,
  });
}

// Exported so that apps can fire-and-forget pre-warm these dynamic imports
// during cold start (e.g. from main.tsx right after telegram bootstrap).
// The chunk download + parse then overlaps with React mount / Privy auth,
// removing the ~300–700ms penalty on the first order of a session.
export async function loadHyperliquidSDK() {
  if (!HyperliquidSDK) {
    await ensureNodeWebSocketGlobal();
    const module = await import("@nktkas/hyperliquid");
    HyperliquidSDK = module;
  }
  return HyperliquidSDK;
}

export async function loadHyperliquidSigning() {
  if (!HyperliquidSigning) {
    const module = await import("@nktkas/hyperliquid/signing");
    HyperliquidSigning = module;
  }
  return HyperliquidSigning;
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

const PORTFOLIO_PERIOD_KEY: Record<PortfolioRange, "day" | "week" | "month"> = {
  "1d": "day",
  "7d": "week",
  "30d": "month",
};

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
    collateralAsset?: StableSwapAsset;
  }>;
}

interface NormalizedOrderContext {
  market: CachedMarket;
  price: string;
  size: string;
  reduceOnly: boolean;
  side: OrderSide;
  tif: "Gtc" | "Ioc" | "Alo";
  cloid: `0x${string}`;
  debug?: {
    executionSource: "mid" | "assetCtx" | "orderbook";
    formattedPrice: string;
    rawExecutionPrice: number;
    referencePrice: number;
  };
}

interface NormalizedTriggerOrderContext {
  cloid: `0x${string}`;
  market: CachedMarket;
  price: string;
  side: OrderSide;
  size: string;
  triggerKind: TriggerOrderKind;
  triggerPx: string;
}

export interface HyperliquidClientConfig {
  walletAddress?: string;
  masterAccountAddress?: string;
  customSigner?: unknown;
  testnet?: boolean;
}

const MIN_ORDER_NOTIONAL_USD = 10;
const STABLE_COLLATERAL_ASSETS: StableSwapAsset[] = [
  "USDC",
  "USDH",
  "USDT",
  "USDE",
];

function inferStableCollateralAsset(
  marketName: string | undefined,
): StableSwapAsset | undefined {
  const asset = marketName
    ?.toUpperCase()
    .match(/-(USDC|USDH|USDT|USDE)\b/u)?.[1] as StableSwapAsset | undefined;
  return asset && STABLE_COLLATERAL_ASSETS.includes(asset) ? asset : undefined;
}

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
  private marketCacheLoad: Promise<MarketCache> | null = null;
  private builderApprovalCache: {
    result: ReturnType<typeof getBuilderConfig>;
    expiresAt: number;
  } | null = null;
  private userStateCache: { data: AccountState; expiresAt: number } | null =
    null;
  private midsCache: {
    data: Record<string, string>;
    expiresAt: number;
  } | null = null;
  private assetCtxsCache: {
    data: any[];
    perpUniverse: any[];
    timestamp: number;
  } | null = null;
  private hip3AssetCtxsCache: Map<
    string,
    { data: any[]; universe: any[]; timestamp: number }
  > = new Map();
  // HIP-3 dex universes load on demand, one request per dex. In-flight loads
  // are shared so concurrent resolveMarket calls for the same dex issue one
  // request; loadedHip3Dexes is what every per-dex fan-out iterates, so a dex
  // nobody asked for costs nothing.
  private hip3DexLoads = new Map<string, Promise<void>>();
  private loadedHip3Dexes = new Set<string>();
  private leverageTypeCache = new Map<string, boolean>();

  constructor(config: HyperliquidClientConfig) {
    this.walletAddress =
      config.masterAccountAddress ?? config.walletAddress ?? "";
    this.testnet = config.testnet ?? false;
    this.config = {
      ...config,
      masterAccountAddress: config.masterAccountAddress ?? config.walletAddress,
    };
    this.wsManager = new WebSocketManager(this.testnet);
  }

  /**
   * Attach the connected main-wallet provider without replacing the
   * account-scoped client (and therefore without splitting agent-key state).
   */
  setCustomSigner(customSigner: unknown): void {
    if (!customSigner || this.config.customSigner === customSigner) return;
    this.config.customSigner = customSigner;
    this.walletClientInstance = null;
  }

  private getHttpApiUrl(): string {
    return this.testnet
      ? "https://api.hyperliquid-testnet.xyz"
      : "https://api.hyperliquid.xyz";
  }

  private async postInfo<T>(body: Record<string, unknown>): Promise<T> {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.getHttpApiUrl()}/info`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429 && attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); // 500ms, 1s, 2s
        continue;
      }

      if (!response.ok) {
        throw new Error(`Info request failed with status ${response.status}`);
      }

      return response.json() as Promise<T>;
    }
    throw new Error("Info request failed after retries");
  }

  private getSignatureChainId(): string {
    return this.testnet ? "0x66eee" : "0xa4b1";
  }

  private async postExchange<T>(body: Record<string, unknown>): Promise<T> {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const signal = AbortSignal.timeout(15_000); // 15s hard deadline per attempt
      const response = await fetch(`${this.getHttpApiUrl()}/exchange`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (response.status === 429 && attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); // 500ms, 1s, 2s
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Exchange request failed with status ${response.status}`,
        );
      }

      return response.json() as Promise<T>;
    }
    throw new Error("Exchange request failed after retries");
  }

  private async sendUserSignedAction(args: {
    action: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
  }) {
    if (!this.config.customSigner) throw new Error("Wallet not connected");
    const Signing = await loadHyperliquidSigning();
    const signature = await Signing.signUserSignedAction({
      wallet: this.config.customSigner,
      action: args.action,
      types: args.types,
      chainId: parseInt(this.getSignatureChainId(), 16),
    });

    const response = await this.postExchange<any>({
      action: args.action,
      signature,
      nonce: Number(args.action.nonce),
    });

    if (response?.status === "err") {
      throw new Error(
        typeof response.response === "string"
          ? response.response
          : "Exchange request failed",
      );
    }

    return response;
  }

  private async getPublicClient() {
    if (!this.publicClientInstance) {
      const SDK = await loadHyperliquidSDK();
      const transport = new SDK.HttpTransport({
        url: this.testnet
          ? "https://hyperliquid-testnet.xyz"
          : "https://hyperliquid.xyz",
      });
      this.publicClientInstance = new SDK.PublicClient({ transport });
    }
    return this.publicClientInstance;
  }

  // Main wallet client — uses the Privy signer. Only for setup actions (approveAgent, approveBuilderFee).
  private async getMainWalletClient() {
    if (!this.walletClientInstance) {
      if (!this.config.customSigner) throw new Error("Wallet not connected");
      const SDK = await loadHyperliquidSDK();
      const transport = new SDK.HttpTransport({
        url: this.testnet
          ? "https://hyperliquid-testnet.xyz"
          : "https://hyperliquid.xyz",
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
      const viemWallet = createWalletClient({
        account,
        transport: http(apiUrl),
      });
      const transport = new SDK.HttpTransport({ url: apiUrl });
      this.agentWalletClientInstance = new SDK.WalletClient({
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

  /** The address of the agent currently signing, or null when there is none. */
  agentAddress(): string | null {
    return this.agentPrivateKey ? getAgentAddress(this.agentPrivateKey) : null;
  }

  /**
   * Forget the in-memory agent signer.
   *
   * Useless on its own, and deliberately narrow: the hook layer reinstates a
   * signer from localStorage on the next render, so a key the exchange has
   * refused has to be dropped from both places or it comes straight back.
   */
  clearAgentKey(): void {
    this.agentPrivateKey = null;
    this.agentWalletClientInstance = null;
  }

  private async ensureMarketCache(): Promise<MarketCache> {
    if (this.marketCache) return this.marketCache;
    // Concurrent first callers used to each run the whole build and each get a
    // different cache object, so a lazy dex load could land on one instance
    // while the caller held the other and saw the symbol as unknown.
    if (this.marketCacheLoad) return this.marketCacheLoad;

    this.marketCacheLoad = this.buildMarketCache().finally(() => {
      this.marketCacheLoad = null;
    });
    return this.marketCacheLoad;
  }

  private async buildMarketCache(): Promise<MarketCache> {
    const client = await this.getPublicClient();
    const [spotMeta, metaAndCtxs, perpDexsResponse] = await Promise.all([
      client.spotMeta(),
      this.postInfo<any>({ type: "metaAndAssetCtxs" }),
      this.postInfo<Array<{ name: string } | null>>({ type: "perpDexs" }).catch(
        () => [null],
      ),
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
      .map((entry, dexIndex) =>
        entry
          ? { dex: entry.name, dexIndex, collateralAsset: undefined }
          : null,
      )
      .filter(Boolean) as Array<{
      dex: string;
      dexIndex: number;
      collateralAsset?: StableSwapAsset;
    }>;

    const perpMarkets = metaAndCtxs[0].universe
      .map((market: any, index: number) => {
        // Must map BEFORE filtering so `index` matches the original universe position,
        // which is what Hyperliquid uses as the asset ID in all exchange requests.
        if (market.isDelisted) return null;
        const cached: CachedMarket = {
          asset: index,
          aliases: [market.name],
          baseCoin: market.name,
          dex: undefined,
          dexIndex: 0,
          isHip3: false,
          marketType: "perp",
          maxLeverage: market.maxLeverage,
          minBaseSize: 10 ** -market.szDecimals,
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
      })
      .filter((m: any) => m !== null);

    const spotMarkets = spotMeta.universe.map((pair: any) => {
      const baseToken = tokensByIndex[pair.tokens[0]];
      const quoteToken = tokensByIndex[pair.tokens[1]];
      const aliases = [pair.name, `@${pair.index}`];
      const cached: CachedMarket = {
        asset: 10000 + pair.index,
        aliases,
        baseCoin: baseToken?.name ?? pair.name,
        marketType: "spot",
        maxLeverage: 1,
        minBaseSize: 10 ** -(baseToken?.szDecimals ?? 0),
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
        quoteName: quoteToken?.name ?? "USDC",
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
      // HIP-3 markets are appended by ensureHip3Dex as dexes are loaded.
      perpMarkets,
      spot,
      spotMarkets,
      spotTokenNames: new Set(
        spotMeta.tokens.map((token: any) => token.name),
      ) as Set<string>,
    };

    return this.marketCache;
  }

  /**
   * Load one HIP-3 dex's universe into the market cache.
   *
   * Loading every dex up front cost one request per dex on top of spotMeta,
   * metaAndAssetCtxs and perpDexs. Mainnet lists 9 named dexes, which was
   * tolerable; testnet lists 247, which rate-limits itself before an order can
   * be signed. A dex is now loaded only when a symbol on it is requested.
   *
   * One dex must not be able to take the market cache down, so a failure is
   * logged and swallowed: it costs that dex's markets, which resolveMarket then
   * reports as an unknown market, and leaves standard perps and spot alone. The
   * memo is dropped on failure so a transient 429 does not disable the dex for
   * the lifetime of the client.
   */
  private async ensureHip3Dex(dex: string): Promise<void> {
    const cache = this.marketCache;
    if (!cache) return;
    if (this.loadedHip3Dexes.has(dex)) return;

    const inFlight = this.hip3DexLoads.get(dex);
    if (inFlight) return inFlight;

    const dexEntry = cache.perpDexs.find((entry) => entry.dex === dex);
    if (!dexEntry) return;
    const { dexIndex } = dexEntry;

    const load = (async () => {
      const dexMetaAndCtxs = await this.postInfo<any>({
        type: "metaAndAssetCtxs",
        dex,
      }).catch((error: unknown) => {
        console.error(
          `[hyperliquid] HIP-3 dex ${dex} metadata unavailable`,
          error,
        );
        return null;
      });
      if (!dexMetaAndCtxs?.[0]?.universe) {
        this.hip3DexLoads.delete(dex);
        return;
      }

      const collateralAsset = inferStableCollateralAsset(
        dexMetaAndCtxs[0].universe.find((market: any) => !market?.isDelisted)
          ?.name,
      );
      if (collateralAsset) {
        dexEntry.collateralAsset = collateralAsset;
      }

      this.hip3AssetCtxsCache.set(dex, {
        data: dexMetaAndCtxs[1] ?? [],
        universe: dexMetaAndCtxs[0].universe,
        timestamp: Date.now(),
      });

      const markets = dexMetaAndCtxs[0].universe
        .map((market: any, index: number) => {
          // Must map BEFORE filtering so `index` matches the original universe position,
          // which is required for the correct HIP-3 asset formula: 100000 + dexIndex*10000 + index
          if (market.isDelisted) return null;
          // Strip any dex prefix the API may have included to avoid "xyz:xyz:GOLD-USDC"
          const bareName = market.name.includes(":")
            ? market.name.split(":").pop()!
            : market.name;
          const fullName = `${dex}:${bareName}`;
          const cached: CachedMarket = {
            asset: 100000 + dexIndex * 10000 + index,
            aliases: [fullName],
            baseCoin: bareName,
            dex,
            dexIndex,
            isHip3: true,
            marketType: "perp",
            maxLeverage: market.maxLeverage,
            minBaseSize: 10 ** -market.szDecimals,
            minNotionalUsd: MIN_ORDER_NOTIONAL_USD,
            name: fullName,
            onlyIsolated: Boolean(market.onlyIsolated),
            priceDecimals: Math.max(0, 6 - market.szDecimals),
            szDecimals: market.szDecimals,
          };
          cache.perp[fullName.toUpperCase()] = cached;
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
        })
        .filter((m: any) => m !== null);

      cache.perpMarkets.push(...markets);
      this.loadedHip3Dexes.add(dex);
    })();

    this.hip3DexLoads.set(dex, load);
    return load;
  }

  /**
   * Load every HIP-3 dex. This is the old eager behavior, kept for the paths
   * that genuinely enumerate markets rather than trade one of them.
   */
  async loadAllHip3Dexes(): Promise<void> {
    const cache = await this.ensureMarketCache();
    await Promise.all(cache.perpDexs.map(({ dex }) => this.ensureHip3Dex(dex)));
  }

  /** Dexes whose universe is in the cache — what every per-dex fan-out uses. */
  private getLoadedPerpDexs(): MarketCache["perpDexs"] {
    const cache = this.marketCache;
    if (!cache) return [];
    return cache.perpDexs.filter(({ dex }) => this.loadedHip3Dexes.has(dex));
  }

  async resolveMarket(
    coin: string,
    marketType?: MarketType,
  ): Promise<CachedMarket> {
    const cache = await this.ensureMarketCache();
    const key = coin.toUpperCase();
    const lookup = () =>
      (marketType === "spot"
        ? [cache.spot[key]]
        : marketType === "perp"
          ? [cache.perp[key]]
          : [cache.perp[key], cache.spot[key]]
      ).find(Boolean);

    const resolved = lookup();
    if (resolved) return resolved;

    // A HIP-3 symbol arrives as "dex:SYMBOL", and its dex universe is only
    // fetched on demand. This is the miss that triggers that fetch — one
    // request, for the one dex the order actually needs.
    if (marketType !== "spot" && coin.includes(":")) {
      const prefix = coin.slice(0, coin.indexOf(":")).toLowerCase();
      const dexEntry = cache.perpDexs.find(
        (entry) => entry.dex.toLowerCase() === prefix,
      );
      if (dexEntry) {
        await this.ensureHip3Dex(dexEntry.dex);
        const afterLoad = lookup();
        if (afterLoad) return afterLoad;
      }
    }

    throw new Error(`Unknown market: ${coin}`);
  }

  private getCachedMidPrice(market: CachedMarket): number | null {
    if (!this.midsCache || Date.now() >= this.midsCache.expiresAt) {
      return null;
    }

    for (const alias of market.aliases) {
      const parsed = parsePositiveNumber(this.midsCache.data?.[alias]);
      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  private async resolveMarketPrice(market: CachedMarket): Promise<{
    executionSource: "mid" | "assetCtx" | "orderbook";
    price: number;
  } | null> {
    const cachedMid = this.getCachedMidPrice(market);
    if (cachedMid != null) {
      return { executionSource: "mid", price: cachedMid };
    }

    try {
      const assetCtxPrice = parsePositiveNumber(
        (await this.getAssetCtx(market.name))?.markPx,
      );
      if (assetCtxPrice != null) {
        return { executionSource: "assetCtx", price: assetCtxPrice };
      }
    } catch {
      // Fall through to orderbook fallback.
    }

    try {
      const orderbook = await this.getOrderbook(market.name);
      const midpoint = orderbookMidpoint(
        orderbook?.levels?.bids?.[0]?.px,
        orderbook?.levels?.asks?.[0]?.px,
      );

      if (midpoint != null) {
        return { executionSource: "orderbook", price: midpoint };
      }
    } catch {
      // Surface null below when every fallback path fails.
    }

    return null;
  }

  private formatPrice(rawPrice: number, market: CachedMarket): string {
    return formatPrice(rawPrice, market);
  }

  private formatSize(rawSize: number, market: CachedMarket): string {
    return formatOrderSize(rawSize, market);
  }

  private getOrderValidation(
    order: Order,
    market: CachedMarket,
    referencePrice: number,
    availableBalance?: number,
    options?: { requireBalance?: boolean },
  ): OrderValidationResult {
    return validateOrderInput(
      order,
      market,
      referencePrice,
      availableBalance,
      options,
    );
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
    const hex = Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return `${APP_TRADE_CLOID_PREFIX}${hex.slice(
      APP_TRADE_CLOID_PREFIX.length - 2,
    )}` as `0x${string}`;
  }

  private async getReferencePrice(market: CachedMarket): Promise<number> {
    const marketPrice = await this.resolveMarketPrice(market);
    if (marketPrice != null) {
      return marketPrice.price;
    }
    throw new Error(`No live market price available for ${market.name}`);
  }

  private async getMarketOrderExecutionContext(
    market: CachedMarket,
    side: OrderSide,
  ) {
    const marketPrice = await this.resolveMarketPrice(market);

    if (marketPrice == null) {
      throw new Error(
        `Market price unavailable for ${market.name}. Please retry in a moment.`,
      );
    }

    const rawExecutionPrice = getAggressiveMarketPrice(marketPrice.price, side);

    return {
      executionSource: marketPrice.executionSource,
      rawExecutionPrice,
      referencePrice: marketPrice.price,
    };
  }

  private async ensureBuilderApproval(): Promise<
    ReturnType<typeof getBuilderConfig>
  > {
    const builder = getBuilderConfig();
    if (!builder) return undefined;

    const now = Date.now();
    if (
      this.builderApprovalCache &&
      now < this.builderApprovalCache.expiresAt
    ) {
      return this.builderApprovalCache.result;
    }

    const maxFee = await this.getMaxBuilderFee(getBuilderAddress());
    if (maxFee <= 0) {
      throw new Error("Builder fee approval is required before trading.");
    }

    this.builderApprovalCache = {
      result: builder,
      expiresAt: now + 5 * 60 * 1000,
    };
    return builder;
  }

  private normalizeExchangeError(
    action: string,
    context: Record<string, unknown>,
    error: unknown,
    outcome: import("./exchange-response").AgentRecoveryOutcome = "not-executed",
  ): never {
    // mapExchangeErrorMessage replaces the upstream error with a friendlier
    // message and cannot carry the original, so the real failure would be
    // unrecoverable — from logs and from a developer at a console alike. A
    // trading action that failed during metadata resolution surfaced only as
    // "Rate limited", with nothing to say what actually happened. Record the
    // original before mapping.
    console.error(`[hyperliquid] ${action} failed`, { context, error });

    // Nested trading helpers already classified and reported this refusal.
    // Preserve its action, account and partial-outcome metadata verbatim.
    if (error instanceof AgentAuthorizationError) throw error;

    if (error instanceof Error) {
      // The exchange raises the same "does not exist" for an API wallet it has
      // deregistered and for a master account that never deposited, and the two
      // need opposite advice — reauthorize versus deposit. Only this object
      // knows which signer actually went out, so the two are told apart here
      // rather than in the message mapper, which sees the string alone.
      if (
        isTradingAction(action) &&
        this.agentPrivateKey !== null &&
        isUnknownSignerMessage(error.message)
      ) {
        const authorizationError = new AgentAuthorizationError({
          action,
          accountAddress: this.walletAddress,
          agentAddress: this.agentAddress(),
          exchangeMessage: error.message,
          outcome,
          message:
            "Trading authorization is no longer valid. Reauthorize trading to continue.",
        });

        // Drop the key before the error leaves this frame. The exchange has
        // already refused it, so every later action signed with it fails the
        // same way; keeping it only buys a second identical failure. Both
        // copies have to go — the hook layer restores a signer from storage on
        // the next render, so clearing memory alone brings it right back.
        this.clearAgentKey();
        try {
          clearStoredAgentKey(this.walletAddress);
        } catch {
          // A storage that refuses to be written is not a reason to swallow
          // the trading error the caller is waiting for.
        }

        reportAgentRecoveryIncident(authorizationError);
        throw authorizationError;
      }

      throw new Error(
        mapExchangeErrorMessage(action, error.message) ?? error.message,
      );
    }
    throw new Error(`${action} failed`);
  }

  // Wrapper around the @nktkas/hyperliquid SDK client.order() that retries on
  // HTTP 429. The SDK handles its own HTTP transport so our postExchange retry
  // doesn't cover these calls. Same 3-attempt exponential backoff as postInfo.
  private async retryOrder(
    clientInstance: Awaited<ReturnType<typeof this.getTradingClient>>,
    params: Parameters<typeof clientInstance.order>[0],
  ) {
    const maxRetries = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await clientInstance.order(params);
      } catch (error) {
        lastError = error;
        if (isRateLimitError(error) && attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private unwrapStatuses(response: any) {
    const statusError = findStatusError(response);
    if (statusError) {
      throw new Error(statusError);
    }

    return response;
  }

  private async ensurePerpLeverage(
    market: CachedMarket,
    leverage?: number,
    reduceOnly?: boolean,
  ): Promise<void> {
    if (!leverage || leverage <= 0 || reduceOnly) return;

    const userState = await this.getUserState();
    const existingPosition = userState.assetPositions.find(
      (assetPosition) => assetPosition.position.coin === market.name,
    )?.position;
    const cachedLeverageType = this.leverageTypeCache.get(market.name);
    const isCross = existingPosition
      ? existingPosition.leverage.type === "cross"
      : (cachedLeverageType ?? (market.onlyIsolated ? false : true));

    if (
      existingPosition &&
      existingPosition.leverage.type === (isCross ? "cross" : "isolated") &&
      existingPosition.leverage.value === leverage
    ) {
      this.leverageTypeCache.set(market.name, isCross);
      return;
    }

    try {
      await this.updateLeverage(market.name, leverage, isCross);
      this.leverageTypeCache.set(market.name, isCross);
    } catch (error) {
      if (!isRetryableLeverageError(error) || existingPosition) {
        throw error;
      }

      const fallbackIsCross = !isCross;
      await this.updateLeverage(market.name, leverage, fallbackIsCross);
      this.leverageTypeCache.set(market.name, fallbackIsCross);
    }
  }

  private async normalizeOrder(order: Order): Promise<NormalizedOrderContext> {
    const market = await this.resolveMarket(order.coin, order.marketType);
    const executionContext =
      order.orderType === "market"
        ? await this.getMarketOrderExecutionContext(market, order.side)
        : null;
    const referencePrice =
      order.orderType === "limit"
        ? order.limitPx
        : (executionContext?.referencePrice ??
          (await this.getReferencePrice(market)));

    if (
      !referencePrice ||
      !Number.isFinite(referencePrice) ||
      referencePrice <= 0
    ) {
      throw new Error(`Missing reference price for ${market.name}`);
    }

    const validation = this.getOrderValidation(order, market, referencePrice);
    if (!validation.isValid) {
      throw new Error(validation.reason ?? "Order validation failed.");
    }

    const rawPrice =
      order.orderType === "market"
        ? (executionContext?.rawExecutionPrice ??
          getAggressiveMarketPrice(referencePrice, order.side))
        : referencePrice;
    const rawSize = order.sizeUsd / referencePrice;
    const formattedPrice = this.formatPrice(rawPrice, market);

    return {
      cloid: (order.cloid as `0x${string}` | undefined) ?? this.generateCloid(),
      debug: executionContext
        ? {
            ...executionContext,
            formattedPrice,
          }
        : undefined,
      market,
      price: formattedPrice,
      reduceOnly: order.reduceOnly,
      side: order.side,
      size: this.formatSize(rawSize, market),
      tif:
        (order.tif as "Gtc" | "Ioc" | "Alo") ??
        (order.orderType === "market" ? "Ioc" : "Gtc"),
    };
  }

  private async normalizeTriggerOrder(
    order: TriggerOrderRequest,
  ): Promise<NormalizedTriggerOrderContext> {
    const market = await this.resolveMarket(order.coin, "perp");

    if (!Number.isFinite(order.triggerPx) || order.triggerPx <= 0) {
      throw new Error(`Invalid trigger price for ${market.name}`);
    }

    if (!Number.isFinite(order.size) || order.size <= 0) {
      throw new Error(`Invalid trigger size for ${market.name}`);
    }

    return {
      cloid: (order.cloid as `0x${string}` | undefined) ?? this.generateCloid(),
      market,
      // The limit the triggered market order carries, not the trigger itself.
      // Priced at exactly the trigger it gives the matcher no room: a stop
      // fires because the market reached the trigger, so the book is already
      // at or past it, and after a gap an IOC sell limited to the trigger can
      // die unfilled while the position rides toward liquidation.
      price: this.formatPrice(
        getAggressiveMarketPrice(
          order.triggerPx,
          order.side,
          TRIGGER_ORDER_SLIPPAGE,
        ),
        market,
      ),
      side: order.side,
      size: this.formatSize(order.size, market),
      triggerKind: order.triggerKind,
      triggerPx: this.formatPrice(order.triggerPx, market),
    };
  }

  private async getOpenPosition(
    coin: string,
    waitForPosition: boolean = false,
    attempts: number = waitForPosition ? 20 : 1,
    delayMs: number = waitForPosition ? 300 : 0,
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const userState = await this.getUserState({ fresh: true });
      const position = userState.assetPositions.find(
        (assetPosition) => assetPosition.position.coin === coin,
      )?.position;

      if (position && position.szi !== 0) {
        return position;
      }

      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
      }
    }

    return null;
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

  /**
   * Subscribe to WebSocket connection status changes.
   * Fires immediately when the connection opens or closes.
   * Returns an unsubscribe function.
   */
  onWsStatusChange(callback: (connected: boolean) => void): () => void {
    return this.wsManager.onStatusChange(callback);
  }

  subscribeToOrderbook(
    coin: string,
    callback: (data: WsMessage) => void,
  ): () => void {
    return this.wsManager.subscribe(`l2Book:${coin}`, callback);
  }

  subscribeToTrades(
    coin: string,
    callback: (data: WsMessage) => void,
  ): () => void {
    return this.wsManager.subscribe(`trades:${coin}`, callback);
  }

  subscribeToCandles(
    coin: string,
    interval: string,
    callback: (data: WsMessage) => void,
  ): () => void {
    return this.wsManager.subscribe(`candle:${coin}:${interval}`, callback);
  }

  subscribeToUserEvents(callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe("userEvents", callback);
  }

  subscribeToAllMids(callback: (data: WsMessage) => void): () => void {
    return this.wsManager.subscribe("allMids", callback);
  }

  // Get all markets (spot + perp), filtered for tradeable assets
  async getMarkets() {
    // Enumerating markets is the one caller that does need every dex.
    await this.loadAllHip3Dexes();
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
    const referencePrice =
      options?.referencePrice ??
      order.limitPx ??
      (await this.getReferencePrice(market));

    return this.getOrderValidation(
      order,
      market,
      referencePrice,
      options?.availableBalance,
      // This is the pre-flight check a UI calls to decide whether to enable
      // submit, so an unknown balance must not read as valid.
      { requireBalance: true },
    );
  }

  // Get market prices. 3s TTL cache — accepted trade-off:
  // IOC market orders carry a ±3% aggressive buffer (see getAggressiveMarketPrice),
  // so a stale mid only fails to match when the live price moves ≥3% adversely
  // within the 3-second window. See plan: ancient-hugging-alpaca.md Fix #1.
  async getMids() {
    if (this.midsCache && Date.now() < this.midsCache.expiresAt) {
      return this.midsCache.data;
    }
    await this.ensureMarketCache();
    // Only dexes already in the cache. A dex whose markets nobody has asked
    // for has no resolvable symbols, so its mids would go nowhere.
    const [baseMids, ...dexMids] = await Promise.all([
      this.postInfo<Record<string, string>>({ type: "allMids" }),
      ...this.getLoadedPerpDexs().map(({ dex }) =>
        this.postInfo<Record<string, string>>({ type: "allMids", dex }).then(
          (mids) => ({ dex, mids }),
        ),
      ),
    ]);

    const merged = { ...baseMids };
    for (const dexResult of dexMids) {
      Object.entries(dexResult.mids).forEach(([coin, price]) => {
        // Strip any dex prefix the API may include (same fix as in ensureMarketCache)
        const bareCoin = coin.includes(":") ? coin.split(":").pop()! : coin;
        merged[`${dexResult.dex}:${bareCoin}`] = price;
      });
    }
    this.midsCache = { data: merged, expiresAt: Date.now() + 3000 };
    return merged;
  }

  async getMarketPrice(coin: string): Promise<number | null> {
    const market = await this.resolveMarket(coin);
    return (await this.resolveMarketPrice(market))?.price ?? null;
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
        bids: raw.levels[0].map((level: any) => ({
          px: parseFloat(level.px),
          sz: parseFloat(level.sz),
          n: level.n,
        })),
        asks: raw.levels[1].map((level: any) => ({
          px: parseFloat(level.px),
          sz: parseFloat(level.sz),
          n: level.n,
        })),
      },
    };
  }

  // Get candles (last 7 days)
  async getCandles(coin: string, interval: string) {
    const client = await this.getPublicClient();
    const resolved = await this.resolveMarket(coin);
    const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const raw = await client.candleSnapshot({
      coin: resolved.name,
      interval,
      startTime,
    });
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

  // Get user state. Pass { fresh: true } to bypass the short-lived internal cache.
  async getUserState({
    fresh,
  }: { fresh?: boolean } = {}): Promise<AccountState> {
    if (
      !fresh &&
      this.userStateCache &&
      Date.now() < this.userStateCache.expiresAt
    ) {
      return this.userStateCache.data;
    }
    const cache = await this.ensureMarketCache();
    const [
      baseState,
      spotState,
      abstraction,
      hip3DexAbstraction,
      ...dexStates
    ] = await Promise.all([
      this.postInfo<any>({
        type: "clearinghouseState",
        user: this.walletAddress as `0x${string}`,
      }),
      this.postInfo<any>({
        type: "spotClearinghouseState",
        user: this.walletAddress as `0x${string}`,
      }).catch(() => null),
      this.getUserAbstraction(),
      this.getUserDexAbstraction(),
      ...cache.perpDexs.map(({ dex }) =>
        this.postInfo<any>({
          type: "clearinghouseState",
          dex,
          user: this.walletAddress as `0x${string}`,
        }),
      ),
    ]);

    const result = buildAccountState({
      baseState,
      spotState,
      abstraction,
      hip3DexAbstractionEnabled: hip3DexAbstraction,
      perpDexs: cache.perpDexs,
      dexStates,
    });
    this.userStateCache = { data: result, expiresAt: Date.now() + 2000 };
    return result;
  }

  // Get open orders
  async getOpenOrders(): Promise<OpenOrder[]> {
    const client = await this.getPublicClient();
    const rawOrders = await client.frontendOpenOrders({
      user: this.walletAddress as `0x${string}`,
    });
    return rawOrders.map((order: any) => ({
      oid: order.oid,
      coin: order.coin,
      side: order.side === "B" ? "buy" : "sell",
      limitPx: parseFloat(order.limitPx),
      sz: parseFloat(order.sz),
      timestamp: order.timestamp,
      orderType: order.orderType === "Limit" ? "limit" : "market",
      reduceOnly: Boolean(order.reduceOnly),
      tif: order.tif ?? null,
      triggerPx: order.triggerPx ? parseFloat(order.triggerPx) : null,
      isTrigger: Boolean(order.isTrigger),
      isPositionTpsl: Boolean(order.isPositionTpsl),
      cloid: order.cloid ?? null,
    }));
  }

  // Get fills
  async getFills(): Promise<Fill[]> {
    const client = await this.getPublicClient();
    const rawFills = await client.userFills({
      user: this.walletAddress as `0x${string}`,
    });
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
      side: fill.side === "B" ? "buy" : "sell",
      startPosition: parseFloat(fill.startPosition),
      sz: parseFloat(fill.sz),
      tid: fill.tid,
      time: fill.time,
      cloid: fill.cloid ?? null,
    }));
  }

  async placeOrder(order: Order) {
    let normalized: NormalizedOrderContext | undefined;
    let leverageMayHaveChanged = false;
    try {
      const client = await this.getTradingClient();
      normalized = await this.normalizeOrder({
        ...order,
        marketType: order.marketType ?? "perp",
      });

      if (normalized.market.marketType !== "perp") {
        throw new Error(`Use spot order flow for ${normalized.market.name}`);
      }

      const [, builder] = await Promise.all([
        this.ensurePerpLeverage(
          normalized.market,
          order.leverage,
          order.reduceOnly,
        ).then(() => {
          leverageMayHaveChanged = Boolean(
            order.leverage && order.leverage > 0 && !order.reduceOnly,
          );
        }),
        this.ensureBuilderApproval(),
      ]);

      return this.unwrapStatuses(
        await this.retryOrder(client, {
          orders: [
            {
              a: normalized.market.asset,
              b: normalized.side === "buy",
              p: normalized.price,
              s: normalized.size,
              r: normalized.reduceOnly,
              t: { limit: { tif: normalized.tif } },
              c: normalized.cloid,
            },
          ],
          grouping: "na",
          builder,
        }),
      );
    } catch (error) {
      this.normalizeExchangeError(
        "placeOrder",
        {
          coin: order.coin,
          leverage: order.leverage,
          marketType: order.marketType ?? "perp",
          orderType: order.orderType,
          reduceOnly: order.reduceOnly,
          sizeUsd: order.sizeUsd,
          pricing: normalized?.debug,
        },
        error,
        leverageMayHaveChanged ? "partially-executed" : "not-executed",
      );
    }
  }

  async placeTriggerOrder(order: TriggerOrderRequest) {
    try {
      const client = await this.getTradingClient();
      const normalized = await this.normalizeTriggerOrder(order);
      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(
        await this.retryOrder(client, {
          orders: [
            {
              a: normalized.market.asset,
              b: normalized.side === "buy",
              p: normalized.price,
              s: normalized.size,
              r: true,
              t: {
                trigger: {
                  isMarket: true,
                  triggerPx: normalized.triggerPx,
                  tpsl: normalized.triggerKind === "takeProfit" ? "tp" : "sl",
                },
              },
              c: normalized.cloid,
            },
          ],
          grouping: "positionTpsl",
          builder,
        }),
      );
    } catch (error) {
      this.normalizeExchangeError(
        "placeTriggerOrder",
        {
          coin: order.coin,
          side: order.side,
          size: order.size,
          triggerKind: order.triggerKind,
          triggerPx: order.triggerPx,
        },
        error,
      );
    }
  }

  async cancelPositionProtection(coin: string) {
    try {
      const client = await this.getTradingClient();
      const openOrders = await this.getOpenOrders();
      const protectionOrders = openOrders.filter(
        (openOrder) =>
          openOrder.coin === coin &&
          openOrder.isTrigger &&
          openOrder.reduceOnly,
      );

      if (protectionOrders.length === 0) return;

      const market = await this.resolveMarket(coin, "perp");
      return this.unwrapStatuses(
        await client.cancel({
          cancels: protectionOrders.map((openOrder) => ({
            a: market.asset,
            o: openOrder.oid,
          })),
        }),
      );
    } catch (error) {
      this.normalizeExchangeError("cancelPositionProtection", { coin }, error);
    }
  }

  async upsertPositionProtection(request: PositionProtectionRequest) {
    let cancelledExistingProtection = false;
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(request.coin, "perp");

      let positionSzi: number;
      if (request.sizeHint != null && request.sizeHint !== 0) {
        positionSzi = request.sizeHint;
      } else {
        const position = await this.getOpenPosition(market.name, true, 20, 300);
        if (!position) {
          throw new Error(
            `No open position found for ${request.coin}. If your entry just filled, wait a moment and try again from Positions.`,
          );
        }
        positionSzi = position.szi;
      }

      const referencePrice = await this.getReferencePrice(market);
      const { side, size, cancelOids, toPlace } = planPositionProtection({
        positionSzi,
        referencePrice,
        stopLossPx: request.stopLossPx ?? null,
        takeProfitPx: request.takeProfitPx ?? null,
        existingOrders: request.skipCancelExisting
          ? []
          : await this.getOpenOrders(),
        marketName: market.name,
      });

      // Batch cancel (single API call for all cancels)
      if (cancelOids.length > 0) {
        await this.unwrapStatuses(
          await client.cancel({
            cancels: cancelOids.map((o) => ({ a: market.asset, o })),
          }),
        );
        cancelledExistingProtection = true;
      }

      if (toPlace.length === 0) {
        return;
      }

      // Normalize and place all new orders in one batch
      const triggerOrders = await Promise.all(
        toPlace.map(({ triggerPx, triggerKind }) =>
          this.normalizeTriggerOrder({
            coin: market.name,
            side,
            size,
            triggerPx,
            triggerKind,
            reduceOnly: true,
            marketType: "perp",
          }),
        ),
      );

      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(
        await this.retryOrder(client, {
          orders: triggerOrders.map((triggerOrder) => ({
            a: triggerOrder.market.asset,
            b: triggerOrder.side === "buy",
            p: triggerOrder.price,
            s: triggerOrder.size,
            r: true,
            t: {
              trigger: {
                isMarket: true,
                triggerPx: triggerOrder.triggerPx,
                tpsl: triggerOrder.triggerKind === "takeProfit" ? "tp" : "sl",
              },
            },
            c: triggerOrder.cloid,
          })),
          grouping: "positionTpsl",
          builder,
        }),
      );
    } catch (error) {
      this.normalizeExchangeError(
        "upsertPositionProtection",
        { ...request },
        error,
        cancelledExistingProtection ? "partially-executed" : "not-executed",
      );
    }
  }

  async closePosition(coin: string) {
    let executionContext: NormalizedOrderContext["debug"] | undefined;
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(coin, "perp");
      const userState = await this.getUserState();
      const position = userState.assetPositions.find(
        (assetPosition) => assetPosition.position.coin === market.name,
      )?.position;

      if (!position || position.szi === 0) {
        throw new Error(`No open position for ${coin}`);
      }

      const side: OrderSide = position.szi > 0 ? "sell" : "buy";
      const marketExecution = await this.getMarketOrderExecutionContext(
        market,
        side,
      );
      const formattedPrice = this.formatPrice(
        marketExecution.rawExecutionPrice,
        market,
      );
      executionContext = {
        ...marketExecution,
        formattedPrice,
      };
      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(
        await this.retryOrder(client, {
          orders: [
            {
              a: market.asset,
              b: side === "buy",
              p: formattedPrice,
              s: this.formatSize(Math.abs(position.szi), market),
              r: true,
              t: { limit: { tif: "Ioc" } },
              c: this.generateCloid(),
            },
          ],
          grouping: "na",
          builder,
        }),
      );
    } catch (error) {
      this.normalizeExchangeError(
        "closePosition",
        {
          coin,
          pricing: executionContext,
        },
        error,
      );
    }
  }

  // Cancel order
  async cancelOrder(coin: string, oid: number) {
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(coin);
      return this.unwrapStatuses(
        await client.cancel({
          cancels: [{ a: market.asset, o: oid }],
        }),
      );
    } catch (error) {
      this.normalizeExchangeError("cancelOrder", { coin, oid }, error);
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
      this.normalizeExchangeError("cancelAllOrders", { coin }, error);
    }
  }

  // Modify order
  async modifyOrder(oid: number, order: Order) {
    try {
      const client = await this.getTradingClient();
      const normalized = await this.normalizeOrder(order);
      return this.unwrapStatuses(
        await client.modify({
          oid,
          order: {
            a: normalized.market.asset,
            b: normalized.side === "buy",
            p: normalized.price,
            s: normalized.size,
            r: normalized.reduceOnly,
            t: { limit: { tif: normalized.tif } },
            c: normalized.cloid,
          },
        }),
      );
    } catch (error) {
      this.normalizeExchangeError(
        "modifyOrder",
        {
          coin: order.coin,
          oid,
          orderType: order.orderType,
          sizeUsd: order.sizeUsd,
        },
        error,
      );
    }
  }

  // Update leverage
  async updateLeverage(
    coin: string,
    leverage: number,
    isCross: boolean = true,
  ) {
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(coin, "perp");
      return client.updateLeverage({
        asset: market.asset,
        isCross,
        leverage,
      });
    } catch (error) {
      this.normalizeExchangeError(
        "updateLeverage",
        { coin, leverage, isCross },
        error,
      );
    }
  }

  // Update isolated margin
  async updateIsolatedMargin(coin: string, amount: number) {
    try {
      const client = await this.getTradingClient();
      const market = await this.resolveMarket(coin, "perp");
      return client.updateIsolatedMargin({
        asset: market.asset,
        isBuy: true,
        ntli: amount,
      });
    } catch (error) {
      this.normalizeExchangeError(
        "updateIsolatedMargin",
        { amount, coin },
        error,
      );
    }
  }

  // Get funding history
  async getFundingHistory(coin: string, startTime?: number) {
    const resolved = await this.resolveMarket(coin, "perp");
    if (resolved.dex) {
      return this.postInfo<any>({
        type: "fundingHistory",
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
    return client.historicalOrders({
      user: this.walletAddress as `0x${string}`,
    });
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
        marketType: "spot",
      });
      const builder = await this.ensureBuilderApproval();

      return this.unwrapStatuses(
        await this.retryOrder(client, {
          orders: [
            {
              a: normalized.market.asset,
              b: normalized.side === "buy",
              p: normalized.price,
              s: normalized.size,
              r: false,
              t: { limit: { tif: normalized.tif } },
              c: normalized.cloid,
            },
          ],
          grouping: "na",
          builder,
        }),
      );
    } catch (error) {
      this.normalizeExchangeError(
        "placeSpotOrder",
        {
          coin: order.coin,
          orderType: order.orderType,
          sizeUsd: order.sizeUsd,
          pricing: normalized?.debug,
        },
        error,
      );
    }
  }

  // Approve agent wallet to act on behalf of this user
  async approveAgent(agentAddress: string): Promise<{ expiryMs: number }> {
    const expiryMs = Date.now() + AGENT_APPROVAL_WINDOW_MS;
    try {
      const client = await this.getMainWalletClient();
      await client.approveAgent({
        agentAddress: agentAddress as `0x${string}`,
        agentName: buildAgentName(expiryMs),
      });
      return { expiryMs };
    } catch (error) {
      this.normalizeExchangeError("approveAgent", { agentAddress }, error);
      // normalizeExchangeError always throws, but TypeScript needs this
      throw error;
    }
  }

  /**
   * Revoke trading authorization by replacing the named agent with one whose
   * key is destroyed immediately.
   *
   * Hyperliquid has no "revoke agent" action. What it has is the rule that an
   * approval under an existing name deregisters the agent currently holding
   * that name, so revocation is expressed as an approval nobody can use. The
   * replacement is a freshly generated address rather than the zero address:
   * the zero address is not documented to be accepted, and reusing any earlier
   * agent address is explicitly discouraged, because a deregistered agent's
   * nonce state may be pruned and its old signatures replayed.
   *
   * Errors are left to the caller. It has to separate a signature the user
   * declined, which changes nothing, from a transport failure, which leaves
   * the outcome genuinely unknown — and only the caller can act on either.
   */
  async revokeAgent(): Promise<{
    previousAgentAddress: string | null;
    replacementAddress: string;
    remoteConfirmed: boolean;
  }> {
    const previousAgentAddress = this.agentAddress();
    const replacementKey = generateAgentKey();
    const replacementAddress = getAgentAddress(replacementKey);
    const expiryMs = Date.now() + AGENT_APPROVAL_WINDOW_MS;

    try {
      const client = await this.getMainWalletClient();
      await client.approveAgent({
        agentAddress: replacementAddress as `0x${string}`,
        agentName: buildAgentName(expiryMs),
      });
    } catch (error) {
      // The hook keeps the current key when the user cancels. Preserve the
      // provider's 4001/code shape so that decision survives this boundary.
      if (isUserRejectedSignature(error)) throw error;
      this.normalizeExchangeError("revokeAgent", { replacementAddress }, error);
      throw error;
    }

    // Read the account back rather than trusting the write. Anything still
    // holding one of our names after the replacement landed means revocation
    // did not do what it claims — including agents from before the name was
    // held constant, which no single replacement can displace.
    const remoteConfirmed = await this.getExtraAgents()
      .then((agents) =>
        agents.every(
          (agent: { address?: string; name?: string }) =>
            !isTsunamiAgentName(agent.name) ||
            agent.address?.toLowerCase() === replacementAddress.toLowerCase(),
        ),
      )
      .catch(() => false);

    return { previousAgentAddress, replacementAddress, remoteConfirmed };
  }

  // Approve builder fee for this user
  async approveBuilderFee(builder: string, maxFeeRate: string) {
    try {
      const client = await this.getMainWalletClient();
      return await client.approveBuilderFee({
        builder: builder as `0x${string}`,
        maxFeeRate: maxFeeRate as `${string}%`,
      });
    } catch (error) {
      this.normalizeExchangeError(
        "approveBuilderFee",
        { builder, maxFeeRate },
        error,
      );
    }
  }

  // Check max approved builder fee for this user
  async getMaxBuilderFee(builder: string): Promise<number> {
    const client = await this.getPublicClient();
    return client.maxBuilderFee({
      user: this.walletAddress as `0x${string}`,
      builder: builder as `0x${string}`,
    });
  }

  getBuilderStatus() {
    return {
      configured: isBuilderConfigured(),
      feeTenthsBp: isBuilderConfigured() ? (getBuilderConfig()?.f ?? 0) : 0,
    };
  }

  // Refresh asset contexts cache (30-second TTL, independent of market metadata)
  private async refreshAssetCtxs(): Promise<void> {
    const ASSET_CTX_TTL_MS = 30_000;
    const now = Date.now();
    if (
      this.assetCtxsCache &&
      now - this.assetCtxsCache.timestamp < ASSET_CTX_TTL_MS
    ) {
      return;
    }
    // Loaded dexes only: this runs on the order path via getAssetCtx, where
    // refreshing 247 testnet dexes to price one BTC order is what rate-limited
    // the order in the first place.
    const perpDexs = this.getLoadedPerpDexs();
    const [metaAndCtxs, ...dexResults] = await Promise.all([
      this.postInfo<any>({ type: "metaAndAssetCtxs" }),
      ...perpDexs.map(({ dex }) =>
        this.postInfo<any>({ type: "metaAndAssetCtxs", dex }).then((r) => ({
          dex,
          r,
        })),
      ),
    ]);
    this.assetCtxsCache = {
      data: metaAndCtxs[1],
      perpUniverse: metaAndCtxs[0].universe,
      timestamp: now,
    };
    for (const { dex, r } of dexResults) {
      this.hip3AssetCtxsCache.set(dex, {
        data: r[1] ?? [],
        universe: r[0].universe,
        timestamp: now,
      });
    }
  }

  // Get market stats for all perp assets (24h vol, price change, OI, funding)
  async getMarketStats(): Promise<Record<string, MarketStats>> {
    const cache = await this.ensureMarketCache();
    await this.refreshAssetCtxs();
    const { data, perpUniverse } = this.assetCtxsCache!;
    const [spotMetaAndCtxs] = await Promise.all([
      this.postInfo<any>({ type: "spotMetaAndAssetCtxs" }).catch(() => null),
    ]);
    const hip3MetaAndCtxs = cache.perpDexs
      .map(({ dex }) => {
        const cached = this.hip3AssetCtxsCache.get(dex);
        return {
          dex,
          response: cached
            ? [{ universe: cached.universe }, cached.data]
            : null,
        };
      })
      .filter(({ response }) => response !== null) as Array<{
      dex: string;
      response: any[];
    }>;
    const result: Record<string, MarketStats> = {};

    for (let i = 0; i < perpUniverse.length; i++) {
      const meta = perpUniverse[i];
      const ctx = data[i];
      if (!ctx || meta.isDelisted) continue;

      const markPx = parseFloat(ctx.markPx ?? "0");
      const prevDayPx = parseFloat(ctx.prevDayPx ?? "0");
      const change24h =
        prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;

      result[meta.name] = {
        coin: meta.name,
        markPx,
        prevDayPx,
        dayNtlVlm: parseFloat(ctx.dayNtlVlm ?? "0"),
        openInterest: parseFloat(ctx.openInterest ?? "0"),
        funding: parseFloat(ctx.funding ?? "0"),
        oraclePx: parseFloat(ctx.oraclePx ?? "0"),
        change24h,
      };
    }

    const spotCtxs = Array.isArray(spotMetaAndCtxs?.[1])
      ? spotMetaAndCtxs[1]
      : [];
    for (const ctx of spotCtxs) {
      const coin = typeof ctx?.coin === "string" ? ctx.coin : null;
      if (!coin) continue;

      const markPx = parseFloat(ctx.markPx ?? ctx.midPx ?? "0");
      const prevDayPx = parseFloat(ctx.prevDayPx ?? "0");
      const oraclePx = parseFloat(ctx.oraclePx ?? ctx.midPx ?? "0");
      const change24h =
        prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;

      result[coin] = {
        coin,
        markPx,
        prevDayPx,
        dayNtlVlm: parseFloat(ctx.dayNtlVlm ?? "0"),
        openInterest: 0,
        funding: 0,
        oraclePx,
        change24h,
      };
    }

    for (const { dex, response } of hip3MetaAndCtxs) {
      const hip3Universe = response?.[0]?.universe ?? [];
      const hip3Ctxs = response?.[1] ?? [];

      for (let i = 0; i < hip3Universe.length; i++) {
        const meta = hip3Universe[i];
        const ctx = hip3Ctxs[i];
        if (!ctx || meta?.isDelisted) continue;

        const bareName = meta.name.includes(":")
          ? meta.name.split(":").pop()!
          : meta.name;
        const coin = `${dex}:${bareName}`;
        const markPx = parseFloat(ctx.markPx ?? "0");
        const prevDayPx = parseFloat(ctx.prevDayPx ?? "0");
        const change24h =
          prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;

        result[coin] = {
          coin,
          markPx,
          prevDayPx,
          dayNtlVlm: parseFloat(ctx.dayNtlVlm ?? "0"),
          openInterest: parseFloat(ctx.openInterest ?? "0"),
          funding: parseFloat(ctx.funding ?? "0"),
          oraclePx: parseFloat(ctx.oraclePx ?? "0"),
          change24h,
        };
      }
    }

    return result;
  }

  // Get asset context for a single coin (OI, funding, 24h vol, mark price)
  async getAssetCtx(coin: string): Promise<AssetCtx | null> {
    const stats = await this.getMarketStats();
    return stats[coin] ?? null;
  }

  private parsePortfolioSeries(series: unknown): PortfolioHistoryPoint[] {
    if (!Array.isArray(series)) return [];

    return series
      .map((point: unknown) => {
        if (!Array.isArray(point) || point.length < 2) return null;
        const time = Number(point[0]);
        const value = parseFloat(String(point[1] ?? "0"));
        if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
        return { time, value };
      })
      .filter(
        (point: PortfolioHistoryPoint | null): point is PortfolioHistoryPoint =>
          point !== null,
      )
      .sort(
        (left: PortfolioHistoryPoint, right: PortfolioHistoryPoint) =>
          left.time - right.time,
      );
  }

  // Get parsed portfolio series for a selected timeframe.
  async getPortfolioPeriod(
    period: PortfolioRange = "7d",
  ): Promise<PortfolioPeriodData> {
    const client = await this.getPublicClient();
    const portfolio = await client.portfolio({
      user: this.walletAddress as `0x${string}`,
    });
    const periodKey = PORTFOLIO_PERIOD_KEY[period];
    const portfolioSeries = Array.isArray(portfolio)
      ? portfolio
      : Array.isArray(portfolio?.portfolio)
        ? portfolio.portfolio
        : [];
    const periodEntry = portfolioSeries.find(
      (entry: any) => Array.isArray(entry) && entry[0] === periodKey,
    );
    const accountValueHistory = this.parsePortfolioSeries(
      periodEntry?.[1]?.accountValueHistory,
    );
    const pnlHistory = this.parsePortfolioSeries(periodEntry?.[1]?.pnlHistory);
    const volume = parseFloat(
      String(periodEntry?.[1]?.vlm ?? periodEntry?.[1]?.volume ?? "0"),
    );

    if (accountValueHistory.length > 0 || pnlHistory.length > 0) {
      return {
        period,
        accountValueHistory,
        pnlHistory,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    }

    const userState = await this.getUserState();
    const accountValue = userState?.marginSummary?.accountValue ?? 0;

    return {
      period,
      accountValueHistory: [{ time: Date.now(), value: accountValue }],
      pnlHistory: [{ time: Date.now(), value: 0 }],
      volume: Number.isFinite(volume) ? volume : 0,
    };
  }

  // Get portfolio value history for area chart
  async getPortfolioHistory(
    period: PortfolioRange = "7d",
  ): Promise<PortfolioHistoryPoint[]> {
    const portfolioPeriod = await this.getPortfolioPeriod(period);
    return portfolioPeriod.accountValueHistory;
  }

  async getUserAbstraction(): Promise<string | null> {
    try {
      return await this.postInfo<string>({
        type: "userAbstraction",
        user: this.walletAddress as `0x${string}`,
      });
    } catch {
      return null;
    }
  }

  async getUserDexAbstraction(): Promise<boolean | null> {
    try {
      return await this.postInfo<boolean>({
        type: "userDexAbstraction",
        user: this.walletAddress as `0x${string}`,
      });
    } catch {
      return null;
    }
  }

  async setUserAbstraction(
    abstraction:
      | Extract<AccountAbstractionMode, "unifiedAccount" | "portfolioMargin">
      | "disabled",
  ) {
    const nonce = Date.now();
    try {
      return await this.sendUserSignedAction({
        action: {
          type: "userSetAbstraction",
          hyperliquidChain: this.testnet ? "Testnet" : "Mainnet",
          signatureChainId: this.getSignatureChainId(),
          user: this.walletAddress as `0x${string}`,
          abstraction,
          nonce,
        },
        types: {
          "HyperliquidTransaction:UserSetAbstraction": [
            { name: "hyperliquidChain", type: "string" },
            { name: "user", type: "address" },
            { name: "abstraction", type: "string" },
            { name: "nonce", type: "uint64" },
          ],
        },
      });
    } catch (error) {
      this.normalizeExchangeError("setUserAbstraction", { abstraction }, error);
    }
  }

  async setUserDexAbstraction(enabled: boolean) {
    const nonce = Date.now();
    try {
      return await this.sendUserSignedAction({
        action: {
          type: "userDexAbstraction",
          hyperliquidChain: this.testnet ? "Testnet" : "Mainnet",
          signatureChainId: this.getSignatureChainId(),
          user: this.walletAddress as `0x${string}`,
          enabled,
          nonce,
        },
        types: {
          "HyperliquidTransaction:UserDexAbstraction": [
            { name: "hyperliquidChain", type: "string" },
            { name: "user", type: "address" },
            { name: "enabled", type: "bool" },
            { name: "nonce", type: "uint64" },
          ],
        },
      });
    } catch (error) {
      this.normalizeExchangeError("setUserDexAbstraction", { enabled }, error);
    }
  }

  async getExtraAgents() {
    const client = await this.getPublicClient();
    return client.extraAgents({
      user: this.walletAddress as `0x${string}`,
    });
  }

  async revokeBuilderFee() {
    if (!isBuilderConfigured()) return;
    return this.approveBuilderFee(getBuilderAddress(), "0%");
  }

  async disableUnifiedAccount() {
    return this.setUserAbstraction("disabled");
  }

  // Get spot account balance (HL L1 spot)
  async getSpotBalance() {
    const client = await this.getPublicClient();
    return client.spotClearinghouseState({
      user: this.walletAddress as `0x${string}`,
    });
  }

  getAvailableCollateralForMarket(args: {
    marketName: string;
    accountState: AccountState;
  }): number {
    return getAvailableCollateralForMarket({
      abstractionMode: args.accountState.abstractionMode,
      stableBalances: args.accountState.stableBalances,
      fallbackWithdrawable: args.accountState.withdrawableBalance,
      marketName: args.marketName,
    });
  }

  // Transfer USDC between Perps and Spot accounts on HL L1
  async usdClassTransfer(amount: string, toPerp: boolean) {
    const client = await this.getFundsClient();
    return client.usdClassTransfer({ amount, toPerp });
  }

  async usdSend(destination: string, amount: string) {
    const client = await this.getFundsClient();
    return client.usdSend({
      amount,
      destination: destination as `0x${string}`,
    });
  }

  // Withdraw USDC from HL L1 to Arbitrum address (must be signed by main wallet, not agent)
  async withdraw(destination: string, amount: string) {
    const client = await this.getFundsClient();
    return client.withdraw3({
      destination: destination as `0x${string}`,
      amount,
    });
  }
}
