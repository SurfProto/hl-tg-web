import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
  combineStableBalances,
  getActionableBalances,
  getAvailableCollateralForMarket,
  getNormalizedTotalEquity,
  getVisibleStableBalances,
  inferAbstractionMode,
  normalizePerpStableBalance,
  normalizeStableBalances,
} from "./account-state";
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
  (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
    WebSocket;
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

function mergeStableBalanceState(
  current: StableBalanceState | undefined,
  next: StableBalanceState,
): StableBalanceState {
  return {
    total: (current?.total ?? 0) + next.total,
    hold: (current?.hold ?? 0) + next.hold,
    available: (current?.available ?? 0) + next.available,
    ...(current?.spot || next.spot
      ? {
          spot: {
            total: (current?.spot?.total ?? 0) + (next.spot?.total ?? 0),
            hold: (current?.spot?.hold ?? 0) + (next.spot?.hold ?? 0),
            available:
              (current?.spot?.available ?? 0) +
              (next.spot?.available ?? 0),
          },
        }
      : {}),
    ...(current?.perp || next.perp
      ? {
          perp: {
            total: (current?.perp?.total ?? 0) + (next.perp?.total ?? 0),
            hold: (current?.perp?.hold ?? 0) + (next.perp?.hold ?? 0),
            available:
              (current?.perp?.available ?? 0) +
              (next.perp?.available ?? 0),
          },
        }
      : {}),
  };
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
  private builderApprovalCache: { result: ReturnType<typeof getBuilderConfig>; expiresAt: number } | null = null;
  private userStateCache: { data: AccountState; expiresAt: number } | null = null;
  private midsCache: { data: Record<string, string>; expiresAt: number } | null = null;
  private assetCtxsCache: {
    data: any[];
    perpUniverse: any[];
    timestamp: number;
  } | null = null;
  private hip3AssetCtxsCache: Map<
    string,
    { data: any[]; universe: any[]; timestamp: number }
  > = new Map();
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
        throw new Error(`Exchange request failed with status ${response.status}`);
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

  private async ensureMarketCache(): Promise<MarketCache> {
    if (this.marketCache) return this.marketCache;

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
        entry ? { dex: entry.name, dexIndex, collateralAsset: undefined } : null,
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

    const hip3PerpMarkets = (
      await Promise.all(
        perpDexs.map(async ({ dex, dexIndex }) => {
          const dexMetaAndCtxs = await this.postInfo<any>({
            type: "metaAndAssetCtxs",
            dex,
          });
          const collateralAsset = inferStableCollateralAsset(
            dexMetaAndCtxs?.[0]?.universe?.find(
              (market: any) => !market?.isDelisted,
            )?.name,
          );
          const dexEntry = perpDexs.find((entry) => entry.dex === dex);
          if (dexEntry && collateralAsset) {
            dexEntry.collateralAsset = collateralAsset;
          }

          this.hip3AssetCtxsCache.set(dex, {
            data: dexMetaAndCtxs[1] ?? [],
            universe: dexMetaAndCtxs[0].universe,
            timestamp: Date.now(),
          });

          return dexMetaAndCtxs[0].universe
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
            })
            .filter((m: any) => m !== null);
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
      perpMarkets: [...perpMarkets, ...hip3PerpMarkets],
      spot,
      spotMarkets,
      spotTokenNames: new Set(
        spotMeta.tokens.map((token: any) => token.name),
      ) as Set<string>,
    };

    return this.marketCache;
  }

  async resolveMarket(
    coin: string,
    marketType?: MarketType,
  ): Promise<CachedMarket> {
    const cache = await this.ensureMarketCache();
    const key = coin.toUpperCase();
    const lookups =
      marketType === "spot"
        ? [cache.spot[key]]
        : marketType === "perp"
          ? [cache.perp[key]]
          : [cache.perp[key], cache.spot[key]];

    const resolved = lookups.find(Boolean);
    if (!resolved) throw new Error(`Unknown market: ${coin}`);
    return resolved;
  }

  private stripTrailingZeros(value: string): string {
    if (!value.includes(".")) return value;
    return value
      .replace(/(\.\d*?[1-9])0+$/u, "$1")
      .replace(/\.0+$/u, "")
      .replace(/\.$/u, "");
  }

  private truncateToDecimals(value: number, decimals: number): string {
    const factor = 10 ** decimals;
    const truncated = Math.trunc((value + Number.EPSILON) * factor) / factor;
    return decimals === 0
      ? String(Math.trunc(truncated))
      : this.stripTrailingZeros(truncated.toFixed(decimals));
  }

  private parsePositiveNumber(value: unknown): number | null {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseFloat(value)
          : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private getCachedMidPrice(market: CachedMarket): number | null {
    if (!this.midsCache || Date.now() >= this.midsCache.expiresAt) {
      return null;
    }

    for (const alias of market.aliases) {
      const parsed = this.parsePositiveNumber(this.midsCache.data?.[alias]);
      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  private async resolveMarketPrice(
    market: CachedMarket,
  ): Promise<
    | {
        executionSource: "mid" | "assetCtx" | "orderbook";
        price: number;
      }
    | null
  > {
    const cachedMid = this.getCachedMidPrice(market);
    if (cachedMid != null) {
      return { executionSource: "mid", price: cachedMid };
    }

    try {
      const assetCtxPrice = this.parsePositiveNumber(
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
      const bestBid = this.parsePositiveNumber(orderbook?.levels?.bids?.[0]?.px);
      const bestAsk = this.parsePositiveNumber(orderbook?.levels?.asks?.[0]?.px);
      const midpoint =
        bestBid != null && bestAsk != null
          ? (bestBid + bestAsk) / 2
          : bestBid ?? bestAsk ?? null;

      if (midpoint != null) {
        return { executionSource: "orderbook", price: midpoint };
      }
    } catch {
      // Surface null below when every fallback path fails.
    }

    return null;
  }

  private limitSignificantFigures(
    value: string,
    maxSignificant: number,
  ): string {
    let result = "";
    let significantDigits = 0;
    let seenNonZero = false;

    for (const char of value) {
      if (char === ".") {
        if (!result.includes(".")) {
          result += result === "" ? "0." : ".";
        }
        continue;
      }

      if (!seenNonZero) {
        if (char === "0") {
          result += char;
          continue;
        }
        seenNonZero = true;
      }

      if (significantDigits >= maxSignificant) continue;
      significantDigits += 1;
      result += char;
    }

    return this.stripTrailingZeros(result || "0");
  }

  private formatPrice(rawPrice: number, market: CachedMarket): string {
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      throw new Error(`Invalid price for ${market.name}`);
    }
    const truncated = this.truncateToDecimals(rawPrice, market.priceDecimals);
    const limited = this.limitSignificantFigures(truncated, 5);
    if (limited === "0")
      throw new Error(`Price rounded to zero for ${market.name}`);
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
    const hex = Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return `0x${hex}`;
  }

  private async getReferencePrice(market: CachedMarket): Promise<number> {
    const marketPrice = await this.resolveMarketPrice(market);
    if (marketPrice != null) {
      return marketPrice.price;
    }
    throw new Error(`No live market price available for ${market.name}`);
  }

  private getAggressiveMarketPrice(midPrice: number, side: OrderSide): number {
    // 3% tolerance from mid — matches Hyperliquid's own SDK default.
    // Buy: price 3% above mid (crosses the ask + depth within 3%).
    // Sell: price 3% below mid (crosses the bid + depth within 3%).
    // Worst-case slippage is capped at ~3%; IOC cancels any unfilled remainder.
    const tolerance = 0.03;
    return side === "buy"
      ? midPrice * (1 + tolerance)
      : midPrice * (1 - tolerance);
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

    const rawExecutionPrice = this.getAggressiveMarketPrice(
      marketPrice.price,
      side,
    );

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
    if (this.builderApprovalCache && now < this.builderApprovalCache.expiresAt) {
      return this.builderApprovalCache.result;
    }

    const maxFee = await this.getMaxBuilderFee(getBuilderAddress());
    if (maxFee <= 0) {
      throw new Error("Builder fee approval is required before trading.");
    }

    this.builderApprovalCache = { result: builder, expiresAt: now + 5 * 60 * 1000 };
    return builder;
  }

  private normalizeExchangeError(
    action: string,
    context: Record<string, unknown>,
    error: unknown,
  ): never {
    if (error instanceof Error) {
      const lowerMessage = error.message.toLowerCase();
      const isTradingAction = [
        "cancelAllOrders",
        "cancelPositionProtection",
        "cancelOrder",
        "closePosition",
        "modifyOrder",
        "placeOrder",
        "placeSpotOrder",
        "placeTriggerOrder",
        "upsertPositionProtection",
        "updateIsolatedMargin",
        "updateLeverage",
      ].includes(action);

      if (
        isTradingAction &&
        lowerMessage.includes("must deposit before performing actions")
      ) {
        throw new Error(
          "Trading agent is not linked to a funded Hyperliquid account. Re-run trading setup or deposit funds into your main account.",
        );
      }
      if (
        action === "usdClassTransfer" &&
        lowerMessage.includes("must deposit before performing actions")
      ) {
        throw new Error(
          "Transfer unavailable until your main Hyperliquid account has a deposit. Deposit funds first, then try again.",
        );
      }
      if (
        isTradingAction &&
        lowerMessage.includes(
          "order price cannot be more than 95% away from the reference price",
        )
      ) {
        throw new Error(
          "Order price is too far from the current market price. Adjust your price and try again.",
        );
      }
      if (
        isTradingAction &&
        lowerMessage.includes("could not immediately match")
      ) {
        throw new Error(
          "Market order couldn't fill — no matching orders available. Try a limit order.",
        );
      }
      if (isTradingAction && lowerMessage.includes("insufficient margin")) {
        throw new Error(
          "Insufficient margin for this order size. Reduce size or lower leverage.",
        );
      }
      if (action === "setUserAbstraction") {
        throw new Error(
          "Unified trading approval failed. Approve the signature in your wallet and try again.",
        );
      }
      if (action === "setUserDexAbstraction") {
        throw new Error(
          "HIP-3 abstraction approval failed. Approve the signature in your wallet and try again.",
        );
      }
      if (lowerMessage.includes("429") || lowerMessage.includes("rate limit") || lowerMessage.includes("after retries")) {
        throw new Error("Rate limited — please try again in a moment.");
      }
      throw new Error(error.message);
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
        const msg = error instanceof Error ? error.message.toLowerCase() : "";
        const is429 = msg.includes("429") || msg.includes("rate limit");
        if (is429 && attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
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
    return (
      message.includes("invalid leverage value") ||
      (message.includes("leverage") && message.includes("invalid")) ||
      (message.includes("margin") &&
        (message.includes("cross") || message.includes("isolated")))
    );
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
          this.getAggressiveMarketPrice(referencePrice, order.side))
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
      price: this.formatPrice(order.triggerPx, market),
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
    const cache = await this.ensureMarketCache();
    const [baseMids, ...dexMids] = await Promise.all([
      this.postInfo<Record<string, string>>({ type: "allMids" }),
      ...cache.perpDexs.map(({ dex }) =>
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
  async getUserState({ fresh }: { fresh?: boolean } = {}): Promise<AccountState> {
    if (!fresh && this.userStateCache && Date.now() < this.userStateCache.expiresAt) {
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

    const parseMarginSummary = (marginSummary: any) => ({
      accountValue: parseFloat(marginSummary?.accountValue ?? "0"),
      totalMarginUsed: parseFloat(marginSummary?.totalMarginUsed ?? "0"),
      totalNtlPos: parseFloat(marginSummary?.totalNtlPos ?? "0"),
      totalRawUsd: parseFloat(marginSummary?.totalRawUsd ?? "0"),
    });

    const allStates = [
      { dex: undefined, state: baseState },
      ...dexStates.map((state, index) => ({
        dex: cache.perpDexs[index]?.dex,
        state,
      })),
    ];

    const abstractionMode = inferAbstractionMode(
      abstraction,
      hip3DexAbstraction,
    );
    const spotStableBalances = normalizeStableBalances(spotState?.balances);
    const perpStableBalances = allStates.reduce<
      Partial<Record<StableSwapAsset, StableBalanceState>>
    >((result, { dex, state }) => {
      const collateralAsset = dex
        ? cache.perpDexs.find((entry) => entry.dex === dex)?.collateralAsset
        : "USDC";
      if (!collateralAsset) return result;

      const normalized = normalizePerpStableBalance({
        totalRawUsd: state?.marginSummary?.totalRawUsd,
        totalMarginUsed: state?.marginSummary?.totalMarginUsed,
      });

      result[collateralAsset] = mergeStableBalanceState(
        result[collateralAsset],
        normalized,
      );
      return result;
    }, {});
    const stableBalances = combineStableBalances({
      abstractionMode,
      spotBalances: spotStableBalances,
      perpBalances: perpStableBalances,
    });
    const visibleStableBalances = getVisibleStableBalances(stableBalances);
    const rawMarginSummary = parseMarginSummary(baseState?.marginSummary);
    const crossMarginSummary = parseMarginSummary(
      baseState?.crossMarginSummary,
    );
    const rawWithdrawable = parseFloat(baseState?.withdrawable ?? "0");
    const { availableBalance, withdrawableBalance } = getActionableBalances(
      stableBalances,
      visibleStableBalances.length === 0 ? rawWithdrawable : 0,
    );
    const assetPositions = allStates.flatMap(({ dex, state }) =>
      (state.assetPositions ?? []).map((assetPosition: any) => ({
        type: assetPosition.type,
        position: {
          coin:
            dex && !assetPosition.position.coin.includes(":")
              ? `${dex}:${assetPosition.position.coin}`
              : assetPosition.position.coin,
          szi: parseFloat(assetPosition.position.szi),
          leverage: {
            type: assetPosition.position.leverage.type,
            value: parseFloat(assetPosition.position.leverage.value),
          },
          entryPx: parseFloat(assetPosition.position.entryPx),
          liquidationPx:
            assetPosition.position.liquidationPx != null
              ? parseFloat(assetPosition.position.liquidationPx)
              : null,
          marginUsed: parseFloat(assetPosition.position.marginUsed),
          maxLeverage: parseFloat(assetPosition.position.maxLeverage),
          positionValue: parseFloat(assetPosition.position.positionValue),
          returnOnEquity: parseFloat(assetPosition.position.returnOnEquity),
          unrealizedPnl: parseFloat(assetPosition.position.unrealizedPnl),
        },
      })),
    );
    const marginSummary = {
      ...rawMarginSummary,
      accountValue: getNormalizedTotalEquity({
        availableBalance,
        assetPositions,
      }),
    };

    const result: AccountState = {
      abstractionMode,
      hip3DexAbstractionEnabled: hip3DexAbstraction,
      stableBalances,
      visibleStableBalances,
      availableBalance,
      withdrawableBalance,
      marginSummary,
      crossMarginSummary,
      crossMaintenanceMarginUsed: parseFloat(
        baseState?.crossMaintenanceMarginUsed ?? "0",
      ),
      withdrawable: rawWithdrawable,
      assetPositions,
    };
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
        this.ensurePerpLeverage(normalized.market, order.leverage, order.reduceOnly),
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
      const isLong = positionSzi > 0;
      const side: OrderSide = isLong ? "sell" : "buy";
      const size = Math.abs(positionSzi);
      const stopLossPx = request.stopLossPx ?? null;
      const takeProfitPx = request.takeProfitPx ?? null;

      if (
        stopLossPx != null &&
        (!Number.isFinite(stopLossPx) || stopLossPx <= 0)
      ) {
        throw new Error("Stop loss trigger price must be greater than 0.");
      }

      if (
        takeProfitPx != null &&
        (!Number.isFinite(takeProfitPx) || takeProfitPx <= 0)
      ) {
        throw new Error("Take profit trigger price must be greater than 0.");
      }

      if (stopLossPx != null) {
        const isValidStop = isLong
          ? stopLossPx < referencePrice
          : stopLossPx > referencePrice;
        if (!isValidStop) {
          throw new Error(
            isLong
              ? "Stop loss must be below the current mark price for a long position."
              : "Stop loss must be above the current mark price for a short position.",
          );
        }
      }

      if (takeProfitPx != null) {
        const isValidTakeProfit = isLong
          ? takeProfitPx > referencePrice
          : takeProfitPx < referencePrice;
        if (!isValidTakeProfit) {
          throw new Error(
            isLong
              ? "Take profit must be above the current mark price for a long position."
              : "Take profit must be below the current mark price for a short position.",
          );
        }
      }

      // --- Diff-based upsert: only cancel/place the sides that actually changed ---
      // Classify current open orders for this coin into SL and TP buckets.
      const existingOrders = request.skipCancelExisting
        ? []
        : await this.getOpenOrders();
      const existingForCoin = existingOrders.filter(
        (o) => o.coin === market.name && o.isTrigger && o.reduceOnly,
      );

      // Classify each existing trigger order as SL or TP using price-vs-reference comparison
      // (same logic as classifyProtectionOrder in protection.ts).
      const existingSl = existingForCoin.find((o) => {
        if (o.triggerPx == null) return false;
        return isLong ? o.triggerPx < referencePrice : o.triggerPx > referencePrice;
      }) ?? null;
      const existingTp = existingForCoin.find((o) => {
        if (o.triggerPx == null) return false;
        return isLong ? o.triggerPx > referencePrice : o.triggerPx < referencePrice;
      }) ?? null;

      // Determine which sides need a cancel and/or a place.
      const cancelOids: number[] = [];
      const toPlace: Array<{ triggerPx: number; triggerKind: "stopLoss" | "takeProfit" }> = [];

      // SL side
      const slChanged =
        stopLossPx !== (existingSl?.triggerPx ?? null);
      if (slChanged) {
        if (existingSl) cancelOids.push(existingSl.oid);
        if (stopLossPx != null) toPlace.push({ triggerPx: stopLossPx, triggerKind: "stopLoss" });
      }

      // TP side
      const tpChanged =
        takeProfitPx !== (existingTp?.triggerPx ?? null);
      if (tpChanged) {
        if (existingTp) cancelOids.push(existingTp.oid);
        if (takeProfitPx != null) toPlace.push({ triggerPx: takeProfitPx, triggerKind: "takeProfit" });
      }

      if (cancelOids.length === 0 && toPlace.length === 0) {
        throw new Error("No protection changes to apply.");
      }

      // Batch cancel (single API call for all cancels)
      if (cancelOids.length > 0) {
        await this.unwrapStatuses(
          await client.cancel({
            cancels: cancelOids.map((o) => ({ a: market.asset, o })),
          }),
        );
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
    const expiryMs = Date.now() + 180 * 24 * 60 * 60 * 1000; // 180 days
    try {
      const client = await this.getMainWalletClient();
      await client.approveAgent({
        agentAddress: agentAddress as `0x${string}`,
        agentName: `tsnm-trade-agent valid_until ${expiryMs}`,
      });
      return { expiryMs };
    } catch (error) {
      this.normalizeExchangeError("approveAgent", { agentAddress }, error);
      // normalizeExchangeError always throws, but TypeScript needs this
      throw error;
    }
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
    const perpDexs = this.marketCache?.perpDexs ?? [];
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
      this.normalizeExchangeError(
        "setUserDexAbstraction",
        { enabled },
        error,
      );
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

  // Withdraw USDC from HL L1 to Arbitrum address (must be signed by main wallet, not agent)
  async withdraw(destination: string, amount: string) {
    const client = await this.getFundsClient();
    return client.withdraw3({
      destination: destination as `0x${string}`,
      amount,
    });
  }
}
