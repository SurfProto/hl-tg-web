import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useFundWallet,
  usePrivy,
  useSendTransaction,
  useToken,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { HyperliquidClient } from "./client";
import {
  getBuilderAddress,
  approveBuilderFee as approveBuilderFeeAction,
  isBuilderConfigured,
} from "./builder";
import {
  TSUNAMI_AGENT_NAME,
  clearStoredAgentKey,
  generateAgentKey,
  getAgentAddress,
  getStoredAgentApprovedAt,
  getStoredAgentKey,
  storeAgentApprovedAt,
  storeAgentKey,
  storeAgentExpiry,
  isAgentKeyExpired,
} from "./agent";
import {
  clearAgentRecoveryIncident,
  getLastAgentRecoveryIncident,
  subscribeToAgentRecovery,
  type AgentRecoveryIncident,
} from "./agent-recovery";
import {
  evaluateTradingSetupStatus,
  getUnifiedApprovalState as getUnifiedApprovalSnapshot,
  getSupportedStableAssets,
} from "./account-state";
import {
  formatStableAmount,
  getSpotAvailableBalance,
  parseBalanceAmount,
  resolveStableSwapLeg,
  roundStableAmount,
  type ResolvedStableSwapLeg,
  type StableSpotMarket,
} from "./stable-swap";
import {
  getBuilderApprovalState,
  getUnifiedApprovalRequirementState,
  reduceAgentApproval,
  type AgentApprovalState,
  type UnifiedApprovalState,
} from "./trading-setup";
import { isUserRejectedSignature } from "./exchange-response";
import type {
  AccountState,
  ApprovalRequirementState,
  AssetCtx,
  MarketStats,
  OpenOrder,
  Order,
  PositionProtectionRequest,
  PortfolioHistoryPoint,
  PortfolioPeriodData,
  PortfolioRange,
  StableSwapAsset,
  StableSwapRequest,
  StableSwapResult,
  TradingSetupStatus,
  TriggerOrderRequest,
  WsMessage,
} from "@repo/types";
import { USDC_ARBITRUM, HL_BRIDGE_ARBITRUM } from "./constants";
import {
  DEV_ACCESS_TOKEN,
  getDevAccountScope,
  isDevIdentityEnabled,
} from "./dev-identity";
import {
  fetchAccountFills,
  fetchAccountOrders,
  fetchAccountPortfolio,
  fetchAccountSnapshot,
  type AccountSnapshot,
  fetchEdgeAssetCtx,
  fetchEdgeCandles,
  fetchEdgeMarketPrice,
  fetchEdgeMarketStats,
  fetchEdgeMarkets,
  fetchEdgeMids,
  fetchEdgeOrderbook,
} from "./edge-proxy";

const publicClientCache = new Map<"mainnet" | "testnet", HyperliquidClient>();
const accountClientCache = new Map<string, HyperliquidClient>();
const STABLE_SWAP_ASSETS = getSupportedStableAssets();
const SPOT_USDC_DUST_THRESHOLD = 0.01;
const UNIFIED_ACCOUNT_PREFERENCE_PREFIX = "hl_pref_unified_";

function getUnifiedPreference(walletAddress: string): boolean {
  try {
    return (
      window.localStorage.getItem(
        `${UNIFIED_ACCOUNT_PREFERENCE_PREFIX}${walletAddress.toLowerCase()}`,
      ) === "true"
    );
  } catch {
    return false;
  }
}

function storeUnifiedPreference(walletAddress: string): void {
  try {
    window.localStorage.setItem(
      `${UNIFIED_ACCOUNT_PREFERENCE_PREFIX}${walletAddress.toLowerCase()}`,
      "true",
    );
  } catch {
    // ignore localStorage errors in embedded environments
  }
}

function clearUnifiedPreference(walletAddress: string): void {
  try {
    window.localStorage.removeItem(
      `${UNIFIED_ACCOUNT_PREFERENCE_PREFIX}${walletAddress.toLowerCase()}`,
    );
  } catch {
    // ignore localStorage errors in embedded environments
  }
}

// Persisted builder/unified approval state. These back `initialData` on the
// useBuilderFeeApproval / useUnifiedAccountApproval queries so the trading
// setup status is never "checking" on TradePage mount — eliminating the
// ~500ms first-tap delay. See plan: ancient-hugging-alpaca.md Fix #3.
const BUILDER_APPROVED_KEY = (addr: string) =>
  `hl-builder-approved:${addr.toLowerCase()}`;
const UNIFIED_MODE_KEY = (addr: string) =>
  `hl-unified-mode:${addr.toLowerCase()}`;

function getStoredBuilderApproved(addr: string): number | undefined {
  try {
    const v = window.localStorage.getItem(BUILDER_APPROVED_KEY(addr));
    // Sentinel: "1" means approved (any positive feeTenthsBp), "0" means not.
    // Using 1 as the positive sentinel satisfies the `feeTenthsBp > 0` check
    // that downstream consumers run against this value.
    if (v === "1") return 1;
    if (v === "0") return 0;
    return undefined;
  } catch {
    return undefined;
  }
}

function storeBuilderApproved(addr: string, feeTenthsBp: number): void {
  try {
    window.localStorage.setItem(
      BUILDER_APPROVED_KEY(addr),
      feeTenthsBp > 0 ? "1" : "0",
    );
  } catch {
    // ignore localStorage errors in embedded environments
  }
}

function getStoredUnifiedMode(addr: string): UnifiedApprovalState | undefined {
  try {
    const v = window.localStorage.getItem(UNIFIED_MODE_KEY(addr));
    if (!v) return undefined;
    return {
      enabled: v === "unifiedAccount" || v === "portfolioMargin",
      abstractionMode: v as AccountState["abstractionMode"],
    };
  } catch {
    return undefined;
  }
}

function storeUnifiedMode(
  addr: string,
  mode: AccountState["abstractionMode"],
): void {
  try {
    window.localStorage.setItem(UNIFIED_MODE_KEY(addr), String(mode));
  } catch {
    // ignore localStorage errors in embedded environments
  }
}

/**
 * Stop signing with a key, everywhere it is held.
 *
 * Both copies or neither: the in-memory signer is restored from storage on the
 * next render, so clearing one without the other quietly reinstates the key
 * that just failed.
 */
function forgetAgentKey(client: HyperliquidClient, walletAddress: string) {
  client.clearAgentKey();
  try {
    clearStoredAgentKey(walletAddress);
  } catch {
    // ignore localStorage errors in embedded environments
  }
}

function getLocalAgentApprovalState(
  client: HyperliquidClient,
  walletAddress: string,
): AgentApprovalState {
  const privateKey = getStoredAgentKey(walletAddress);
  if (!privateKey) {
    // Storage is the durable source of truth. If it was cleared while this
    // session was open, do not leave a signer alive only in module memory.
    client.clearAgentKey();
    return {
      address: null,
      approved: false,
      hasLocalKey: false,
      isExpired: false,
      validUntil: null,
      state: "missing",
      reason: "missing-local-key",
      name: null,
      approvedAt: null,
      remoteConfirmed: false,
      lastVerifiedAt: null,
      duplicateNamedAgents: 0,
    };
  }

  if (!client.hasAgentKey()) {
    client.setAgentKey(privateKey);
  }

  const expired = isAgentKeyExpired(walletAddress);

  return {
    address: getAgentAddress(privateKey),
    approved: !expired,
    hasLocalKey: true,
    isExpired: expired,
    validUntil: null,
    state: expired ? "missing" : "approved",
    reason: expired ? "expired" : "active",
    name: TSUNAMI_AGENT_NAME,
    approvedAt: getStoredAgentApprovedAt(walletAddress),
    remoteConfirmed: false,
    lastVerifiedAt: null,
    duplicateNamedAgents: 0,
  };
}

async function getAgentApprovalState(
  client: HyperliquidClient,
  walletAddress: string,
  previousState?: AgentApprovalState,
): Promise<AgentApprovalState> {
  const localState = getLocalAgentApprovalState(client, walletAddress);
  // Named remote approval is useful even when this browser has lost its local
  // key: the user can still revoke it with the main wallet signature.
  const extraAgents = await client.getExtraAgents().catch(() => null);

  const { next, validUntilToPersist } = reduceAgentApproval({
    localState,
    extraAgents,
    previousState,
    now: Date.now(),
  });

  if (validUntilToPersist != null) {
    storeAgentExpiry(walletAddress, validUntilToPersist);
  }

  if (
    next.hasLocalKey &&
    (next.reason === "revoked-or-replaced" || next.reason === "expired")
  ) {
    forgetAgentKey(client, walletAddress);
  }

  return next;
}

function buildTradingSetupStatus(args: {
  abstractionMode: AccountState["abstractionMode"];
  prefersUnifiedAccount: boolean;
  agentApproval: AgentApprovalState | undefined;
  builderMaxFee: number | undefined;
  builderError: boolean;
  unifiedApproval: UnifiedApprovalState | undefined;
  unifiedError: boolean;
}): TradingSetupStatus {
  const status = evaluateTradingSetupStatus({
    agentState: args.agentApproval?.state ?? "checking",
    isAgentExpired: args.agentApproval?.isExpired ?? false,
    abstractionMode: args.abstractionMode,
    prefersUnifiedAccount: args.prefersUnifiedAccount,
    builderState: getBuilderApprovalState(
      args.builderMaxFee,
      args.builderError,
      isBuilderConfigured(),
    ),
    unifiedState: getUnifiedApprovalRequirementState(
      args.unifiedApproval,
      args.unifiedError,
    ),
  });

  return {
    ...status,
    lastVerifiedAt:
      args.agentApproval?.lastVerifiedAt ??
      (status.isChecking ? null : Date.now()),
  };
}

async function waitForSpotBalance(
  client: HyperliquidClient,
  coin: StableSwapAsset,
  predicate: (available: number) => boolean,
  attempts = 12,
  delayMs = 350,
) {
  let lastAvailable = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const spotBalance = await client.getSpotBalance();
    lastAvailable = getSpotAvailableBalance(spotBalance, coin);

    if (predicate(lastAvailable)) {
      return lastAvailable;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return lastAvailable;
}

function getSharedPublicHyperliquidClient(testnet: boolean) {
  const cacheKey = testnet ? "testnet" : "mainnet";
  let client = publicClientCache.get(cacheKey);

  if (!client) {
    client = new HyperliquidClient({ testnet });
    publicClientCache.set(cacheKey, client);
  }

  return client;
}

/**
 * Hook to get a public Hyperliquid client instance (no wallet required).
 * Use for market data: prices, orderbook, candles, etc.
 * Instance is memoized per testnet flag — recreated only when it changes.
 */
function usePublicHyperliquid() {
  const testnet = import.meta.env.VITE_HYPERLIQUID_TESTNET === "true";
  const client = useMemo(
    () => getSharedPublicHyperliquidClient(testnet),
    [testnet],
  );
  return { client };
}

/**
 * The current account's cache scope.
 *
 * Account-scoped queries used to be keyed on a bare string — ["userState"],
 * ["openOrders"], ["fills"] — with nothing identifying whose data it was. After
 * a logout and a login as someone else, React Query served the previous user's
 * balances and orders straight from cache, and `placeholderData` rendered them
 * as if current instead of showing a loading state.
 *
 * Appending this to the key fixes that. It goes at the *end* so the ~40
 * existing `invalidateQueries({ queryKey: ["userState"] })` calls keep matching
 * by prefix.
 */
export function useAccountScope(): string | null {
  const { user } = usePrivy();
  // Local development has no way to sign in — see ./dev-identity.ts. This is the
  // single gate every account query reads, so returning a synthetic scope here
  // enables them all. Removed from production builds by dead-code elimination.
  return user?.id ?? getDevAccountScope();
}

/**
 * Bearer token for the account routes.
 *
 * Locally there is no Privy session to mint one, and the server-side dev bypass
 * ignores the value, so any non-empty string suffices.
 */
export function useAccountToken(): () => Promise<string | null> {
  const { getAccessToken } = useToken();
  return useCallback(async () => {
    if (isDevIdentityEnabled()) return DEV_ACCESS_TOKEN;
    return getAccessToken();
  }, [getAccessToken]);
}

/**
 * Hook to get the Hyperliquid client instance.
 * Instance is memoized by (walletAddress, provider, testnet) — a new client is
 * created only when one of those changes (e.g. logout → login as a different user).
 * Agent key restoration is deferred to a useEffect so it never runs during render.
 */
export function useHyperliquid() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const [providerState, setProviderState] = useState<{
    scope: string;
    provider: unknown;
  } | null>(null);
  const testnet = import.meta.env.VITE_HYPERLIQUID_TESTNET === "true";
  const walletAddress = user?.wallet?.address ?? null;
  const clientScope = walletAddress
    ? `${walletAddress.toLowerCase()}:${testnet ? "testnet" : "mainnet"}`
    : null;
  const previousClientScope = useRef<string | null>(clientScope);

  // getEthereumProvider() is async on ConnectedWallet — resolve it once and store
  const embeddedWallet = wallets.find(
    (w) =>
      w.walletClientType === "privy" &&
      walletAddress != null &&
      w.address?.toLowerCase() === walletAddress.toLowerCase(),
  );
  useEffect(() => {
    let cancelled = false;
    if (!embeddedWallet || !clientScope) {
      setProviderState(null);
      return () => {
        cancelled = true;
      };
    }

    const providerScope = clientScope;
    embeddedWallet.getEthereumProvider().then((provider) => {
      if (!cancelled) setProviderState({ scope: providerScope, provider });
    });
    return () => {
      cancelled = true;
    };
  }, [clientScope, embeddedWallet]);

  // A wallet switch renders before the next provider promise resolves. Never
  // let the prior account's provider cross that render boundary.
  const provider =
    providerState?.scope === clientScope ? providerState.provider : null;

  const client = useMemo(() => {
    if (!walletAddress || !clientScope) return null;
    const existing = accountClientCache.get(clientScope);
    if (existing) return existing;

    const created = new HyperliquidClient({
      masterAccountAddress: walletAddress,
      walletAddress,
      customSigner: provider ?? undefined,
      testnet,
    });
    accountClientCache.set(clientScope, created);
    return created;
  }, [clientScope, provider, testnet, walletAddress]);

  useEffect(() => {
    const previous = previousClientScope.current;
    if (previous && previous !== clientScope) {
      accountClientCache.get(previous)?.clearAgentKey();
      accountClientCache.delete(previous);
    }
    previousClientScope.current = clientScope;
  }, [clientScope]);

  useEffect(() => {
    if (client && provider) client.setCustomSigner(provider);
  }, [client, provider]);

  // Restore agent key from localStorage — runs once per wallet address change, not on every render
  useEffect(() => {
    if (!client || !walletAddress) return;
    const storedKey = getStoredAgentKey(walletAddress);
    if (storedKey && !client.hasAgentKey()) {
      client.setAgentKey(storedKey);
    }
  }, [client, walletAddress]);

  return { client, isConnected: Boolean(client) };
}

/** Test-only reset so a retained signer never leaks state between cases. */
export function __resetHyperliquidClientRegistryForTests(): void {
  for (const client of accountClientCache.values()) client.clearAgentKey();
  accountClientCache.clear();
}

/**
 * Hook to fetch market data
 */
export function useMarketData() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => fetchEdgeMarkets(),
    placeholderData: (previousData) => previousData,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch all mid prices.
 * Uses a WebSocket subscription for real-time updates and falls back to polling
 * every 10 seconds when the WS connection is unavailable.
 */
export function useMids() {
  const { client } = usePublicHyperliquid();
  const queryClient = useQueryClient();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    client.connectWs().then(() => {
      unsubscribe = client.subscribeToAllMids((data: WsMessage) => {
        if (data.channel === "allMids") {
          queryClient.setQueryData(["mids"], data.data);
        }
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [client, queryClient]);

  return useQuery({
    queryKey: ["mids"],
    queryFn: () => fetchEdgeMids(),
    placeholderData: (previousData) => previousData,
    refetchInterval: 10_000, // Fallback polling; WS handles real-time updates
  });
}

/**
 * Hook to fetch the mark price for one coin.
 *
 * Deliberately no placeholderData. `(previousData) => previousData` carries the
 * last *query's* data across a key change, so switching BTC → ETH rendered
 * BTC's price under the ETH heading with no loading state — and a user could
 * size an order against it. Consumers get undefined while the new coin loads.
 */
export function useMarketPrice(coin: string) {
  return useQuery<number | null>({
    queryKey: ["marketPrice", coin],
    queryFn: () => fetchEdgeMarketPrice(coin),
    enabled: !!coin,
    staleTime: 2_000,
    refetchInterval: 10_000,
  });
}

/**
 * Hook to fetch orderbook. No placeholderData, for the same reason as
 * useMarketPrice.
 */
export function useOrderbook(coin: string) {
  return useQuery({
    queryKey: ["orderbook", coin],
    queryFn: () => fetchEdgeOrderbook(coin),
    enabled: !!coin,
    refetchInterval: 2000, // Refetch every 2 seconds
  });
}

/**
 * Hook to fetch candles
 */
export function useCandles(coin: string, interval: string = "1h") {
  return useQuery({
    queryKey: ["candles", coin, interval],
    queryFn: () => fetchEdgeCandles(coin, interval),
    enabled: !!coin,
    // No placeholderData: it would draw the previous coin's candles under the
    // new coin's heading.
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * The one query behind /api/account/snapshot.
 *
 * useUserState and useSpotBalance both used to fetch this endpoint under their
 * own keys and their own refetch intervals (30s and 5s), so every account
 * fetched the same payload twice and spent the per-user rate limit on it. They
 * now select out of this single query.
 */
export function useAccountSnapshot<TSelected = AccountSnapshot>(
  select?: (snapshot: AccountSnapshot) => TSelected,
) {
  const getAccessToken = useAccountToken();
  const scope = useAccountScope();

  return useQuery({
    queryKey: ["userState", scope],
    queryFn: async (): Promise<AccountSnapshot> => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }
      return fetchAccountSnapshot(accessToken);
    },
    enabled: Boolean(scope),
    // No placeholderData on account queries: it would render the previously
    // fetched account's figures while the new one loads.
    refetchInterval: 5_000,
    select,
  });
}

/**
 * Hook to fetch user state (positions, margin, etc.)
 * Subscribes to userEvents over WebSocket so that fills and order updates
 * trigger an immediate refetch instead of waiting for the polling interval.
 */
export function useUserState() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address ?? null;
  const prefersUnifiedAccount =
    walletAddress != null ? getUnifiedPreference(walletAddress) : false;

  const query = useAccountSnapshot((snapshot) => snapshot.userState);

  // Trigger a refetch whenever a user event arrives (fills, order updates, funding, etc.)
  // This cuts balance/position update latency from up to 30s → ~100-300ms.
  useEffect(() => {
    if (!client) return;
    let unsubscribe: (() => void) | undefined;
    client.connectWs().then(() => {
      unsubscribe = client.subscribeToUserEvents(() => {
        queryClient.invalidateQueries({ queryKey: ["userState"] });
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [client, queryClient]);

  const data = useMemo<AccountState | undefined>(() => {
    if (!query.data) return query.data;
    return {
      ...query.data,
      shouldPromptRestoreUnified:
        prefersUnifiedAccount && query.data.abstractionMode === "standard",
    };
  }, [prefersUnifiedAccount, query.data]);

  return { ...query, data };
}

/**
 * Hook to place an order
 */
export function usePlaceOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: Order) => {
      if (!client) throw new Error("Client not connected");
      return client.placeOrder(order);
    },
    onSuccess: () => {
      // Invalidate user state to refresh positions/orders
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to place a spot order
 */
export function usePlaceSpotOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: Order) => {
      if (!client) throw new Error("Client not connected");
      return client.placeSpotOrder(order);
    },
    onSuccess: () => {
      // spotBalance is a select over the userState snapshot query now.
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to place a trigger order.
 */
export function usePlaceTriggerOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: TriggerOrderRequest) => {
      if (!client) throw new Error("Client not connected");
      return client.placeTriggerOrder(order);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to create or replace SL/TP protection for a position.
 */
export function useUpsertPositionProtection() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: PositionProtectionRequest) => {
      if (!client) throw new Error("Client not connected");
      return client.upsertPositionProtection(request);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return k === "userState" || k === "openOrders" || k === "fills";
        },
      });
    },
  });
}

/**
 * Hook to cancel protection orders for a position.
 */
export function useCancelPositionProtection() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coin: string) => {
      if (!client) throw new Error("Client not connected");
      return client.cancelPositionProtection(coin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return k === "userState" || k === "openOrders" || k === "fills";
        },
      });
    },
  });
}

/**
 * Hook to close an open position.
 */
export function useClosePosition() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coin: string) => {
      if (!client) throw new Error("Client not connected");
      return client.closePosition(coin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return k === "userState" || k === "openOrders" || k === "fills";
        },
      });
    },
  });
}

/**
 * Hook to cancel an order.
 * Optimistically removes the order from the local cache so the UI updates
 * instantly; rolls back if the API call fails.
 */
export function useCancelOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();
  const scope = useAccountScope();
  // Exact key — setQueryData does not do prefix matching, so the optimistic
  // write has to target the same scoped key useOpenOrders reads.
  const openOrdersKey = ["openOrders", scope] as const;

  return useMutation({
    mutationFn: ({ coin, oid }: { coin: string; oid: number }) => {
      if (!client) throw new Error("Client not connected");
      return client.cancelOrder(coin, oid);
    },
    onMutate: async ({ oid }) => {
      await queryClient.cancelQueries({ queryKey: openOrdersKey });
      const previous = queryClient.getQueryData<OpenOrder[]>(openOrdersKey);
      queryClient.setQueryData<OpenOrder[]>(
        openOrdersKey,
        (old) => old?.filter((o) => o.oid !== oid) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(openOrdersKey, context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to cancel all orders
 */
export function useCancelAllOrders() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (coin?: string) => {
      if (!client) throw new Error("Client not connected");
      return client.cancelAllOrders(coin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to modify an order
 */
export function useModifyOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ oid, order }: { oid: number; order: Order }) => {
      if (!client) throw new Error("Client not connected");
      return client.modifyOrder(oid, order);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to fetch open orders
 */
export function useOpenOrders() {
  const getAccessToken = useAccountToken();
  const scope = useAccountScope();

  return useQuery({
    queryKey: ["openOrders", scope],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }
      return fetchAccountOrders(accessToken);
    },
    enabled: Boolean(scope),
    refetchInterval: 5000,
  });
}

/**
 * Hook to fetch fills
 */
export function useFills() {
  const getAccessToken = useAccountToken();
  const scope = useAccountScope();

  return useQuery({
    queryKey: ["fills", scope],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }
      return fetchAccountFills(accessToken);
    },
    enabled: Boolean(scope),
    refetchInterval: 10000,
  });
}

/**
 * Hook to fetch historical orders
 */
export function useHistoricalOrders() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ["historicalOrders"],
    queryFn: () => client?.getHistoricalOrders(),
    enabled: !!client,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to fetch funding history
 */
export function useFundingHistory(coin: string, startTime?: number) {
  const { client } = usePublicHyperliquid();

  return useQuery({
    queryKey: ["fundingHistory", coin, startTime],
    queryFn: () => client.getFundingHistory(coin, startTime),
    enabled: !!coin,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch predicted funding rates
 */
export function usePredictedFundingRates() {
  const { client } = usePublicHyperliquid();

  return useQuery({
    queryKey: ["predictedFundingRates"],
    queryFn: () => client.getPredictedFundingRates(),
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

/**
 * Hook to update leverage
 */
export function useUpdateLeverage() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      coin,
      leverage,
      isCross = true,
    }: {
      coin: string;
      leverage: number;
      isCross?: boolean;
    }) => {
      if (!client) throw new Error("Client not connected");
      return client.updateLeverage(coin, leverage, isCross);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to update isolated margin
 */
export function useUpdateIsolatedMargin() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ coin, amount }: { coin: string; amount: number }) => {
      if (!client) throw new Error("Client not connected");
      return client.updateIsolatedMargin(coin, amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
  });
}

/**
 * Hook to fetch portfolio
 */
export function usePortfolio() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => client?.getPortfolio(),
    enabled: !!client,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch spot account balance (HL L1 spot).
 *
 * Selects from the shared snapshot query rather than fetching
 * /api/account/snapshot again on its own 5s timer.
 */
export function useSpotBalance() {
  return useAccountSnapshot((snapshot) => snapshot.spotBalance);
}

/**
 * Hook to transfer USDC between Perps and Spot on HL L1
 */
export function useUsdClassTransfer() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ amount, toPerp }: { amount: string; toPerp: boolean }) => {
      if (!client) throw new Error("Client not connected");
      return client.usdClassTransfer(amount, toPerp);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      // spotBalance is a select over the userState snapshot query now.
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
  });
}

/**
 * Hook to withdraw USDC from HL L1 to Arbitrum
 */
export function useWithdraw() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      destination,
      amount,
    }: {
      destination: string;
      amount: string;
    }) => {
      if (!client) throw new Error("Client not connected");
      return client.withdraw(destination, amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
  });
}

/**
 * Hook to query USDC balance on Arbitrum (before bridging to HL)
 */
export function useArbitrumUsdcBalance(address: string | undefined) {
  return useQuery({
    queryKey: ["arbitrumUsdc", address],
    queryFn: async () => {
      const { createPublicClient, http, erc20Abi } = await import("viem");
      const { arbitrum } = await import("viem/chains");
      const client = createPublicClient({ chain: arbitrum, transport: http() });
      const raw = await client.readContract({
        address: USDC_ARBITRUM,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      return Number(raw) / 1e6; // USDC has 6 decimals
    },
    enabled: Boolean(address),
    refetchInterval: 10000,
  });
}

export function useFundArbitrumUsdc() {
  const { user } = usePrivy();
  const { fundWallet } = useFundWallet();

  return useMutation({
    mutationFn: async ({ address }: { address?: string } = {}) => {
      const walletAddress = address ?? user?.wallet?.address;
      if (!walletAddress) throw new Error("No wallet connected");

      await fundWallet(walletAddress, {
        chain: { id: 42161 },
        amount: "10",
        asset: "USDC",
      });
    },
  });
}

/**
 * Hook to bridge USDC from Arbitrum to Hyperliquid L1
 * Sends USDC directly to the bridge address — Hyperliquid credits the sender on HyperCore.
 * Minimum deposit: 5 USDC
 */
export function useBridgeToHyperliquid() {
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount }: { amount: number }) => {
      if (amount < 5) throw new Error("Minimum deposit is 5 USDC");

      const { createPublicClient, encodeFunctionData, erc20Abi, http } =
        await import("viem");
      const { arbitrum } = await import("viem/chains");

      // Preflight: check Arbitrum USDC balance before sending the transaction
      const walletAddr = user?.wallet?.address;
      if (!walletAddr) throw new Error("No wallet connected");
      const publicClient = createPublicClient({
        chain: arbitrum,
        transport: http(),
      });
      const rawBalance = await publicClient.readContract({
        address: USDC_ARBITRUM,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [walletAddr as `0x${string}`],
      });
      const usdcBalance = Number(rawBalance) / 1e6;
      if (usdcBalance < amount) {
        throw new Error(
          `Insufficient USDC on Arbitrum. You have ${usdcBalance.toFixed(2)} USDC but need ${amount.toFixed(2)} USDC.`,
        );
      }

      const embeddedWallet = wallets.find(
        (w) => w.walletClientType === "privy",
      );
      if (!embeddedWallet) throw new Error("No embedded wallet found");
      const account = embeddedWallet.address as `0x${string}`;
      const amountRaw = BigInt(Math.floor(amount * 1e6));

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [HL_BRIDGE_ARBITRUM, amountRaw],
      });

      await sendTransaction(
        {
          to: USDC_ARBITRUM,
          data,
          value: BigInt(0),
          chainId: arbitrum.id,
        },
        {
          header: "Review Hyperliquid deposit",
          description: `Bridge ${amount.toFixed(2)} USDC from Arbitrum into your Hyperliquid trading balance. Sponsored by Tsunami with love.`,
          buttonText: "Confirm deposit",
          successHeader: "Deposit submitted",
          successDescription:
            "Your USDC transfer to Hyperliquid is on the way.",
          transactionInfo: {
            title: "Deposit details",
            action: "Bridge USDC",
            contractInfo: {
              name: "Sponsored by Tsunami with love",
              url: "https://arbiscan.io/token/0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            },
          },
        },
        undefined,
        account,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["arbitrumUsdc"] });
    },
  });
}

export const SUPPORTED_STABLE_SWAP_ASSETS = STABLE_SWAP_ASSETS;

/**
 * Hook to swap supported stable assets with an automatic perp-USDC pipeline.
 */
export function useStableSwap() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation<StableSwapResult, Error, StableSwapRequest>({
    mutationFn: async ({ fromAsset, toAsset, amount }) => {
      if (!client) throw new Error("Client not connected");
      if (fromAsset === toAsset) {
        throw new Error("Select two different stable assets.");
      }

      const normalizedAmount = roundStableAmount(amount);
      if (normalizedAmount <= 0) {
        throw new Error("Enter a valid swap amount.");
      }

      const markets = await client.getMarkets();
      const spotMarkets = markets.spot
        .filter(
          (market) =>
            STABLE_SWAP_ASSETS.includes(
              market.baseName.toUpperCase() as StableSwapAsset,
            ) &&
            STABLE_SWAP_ASSETS.includes(
              market.quoteName.toUpperCase() as StableSwapAsset,
            ),
        )
        .map((market) => ({
          index: market.index,
          baseName: market.baseName.toUpperCase(),
          quoteName: market.quoteName.toUpperCase(),
        }));
      const tradingState = await client.getUserState();
      const usesUnifiedRouting =
        tradingState.abstractionMode === "unifiedAccount" ||
        tradingState.abstractionMode === "portfolioMargin" ||
        tradingState.abstractionMode === "dexAbstraction";

      const placeStableLeg = async (
        legFrom: StableSwapAsset,
        legTo: StableSwapAsset,
        legAmount: number,
      ) => {
        const resolvedLeg = resolveStableSwapLeg(spotMarkets, legFrom, legTo);
        try {
          await client.placeSpotOrder({
            coin: resolvedLeg.coin,
            side: resolvedLeg.side,
            sizeUsd: roundStableAmount(legAmount),
            orderType: "market",
            reduceOnly: false,
            marketType: "spot",
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Swap leg failed";
          throw new Error(
            `${legFrom} -> ${legTo} failed on ${resolvedLeg.marketName}. ${message}`,
          );
        }
      };

      const transferUsdcToSpot = async (transferAmount: number) => {
        try {
          await client.usdClassTransfer(
            formatStableAmount(transferAmount),
            false,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Transfer failed";
          throw new Error(`Perp to spot transfer failed. ${message}`);
        }

        await waitForSpotBalance(
          client,
          "USDC",
          (available) =>
            available + 0.000001 >= roundStableAmount(transferAmount),
        );
      };

      const sweepUsdcToPerps = async () => {
        const availableUsdc = roundStableAmount(
          await waitForSpotBalance(
            client,
            "USDC",
            (available) => available >= 0,
          ),
        );

        if (availableUsdc <= 0) {
          return {
            sweepBackAmount: 0,
            dustRemaining: 0,
            message: "No spot USDC remained to sweep.",
          };
        }

        if (availableUsdc < SPOT_USDC_DUST_THRESHOLD) {
          return {
            sweepBackAmount: 0,
            dustRemaining: availableUsdc,
            message: `Spot USDC remainder ${availableUsdc.toFixed(6)} is below the automatic sweep threshold.`,
          };
        }

        try {
          await client.usdClassTransfer(
            formatStableAmount(availableUsdc),
            true,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Sweep failed";
          throw new Error(`Return sweep to perp USDC failed. ${message}`);
        }

        return {
          sweepBackAmount: availableUsdc,
          dustRemaining: 0,
          message: `Returned ${availableUsdc.toFixed(2)} USDC to your perp balance.`,
        };
      };

      if (usesUnifiedRouting) {
        if (fromAsset === "USDC" || toAsset === "USDC") {
          await placeStableLeg(fromAsset, toAsset, normalizedAmount);
          return {
            fromAsset,
            toAsset,
            amount: normalizedAmount,
            message: `${toAsset} swap completed using your unified balance.`,
          };
        }

        const initialSpotUsdc = roundStableAmount(
          await waitForSpotBalance(
            client,
            "USDC",
            (available) => available >= 0,
          ),
        );
        await placeStableLeg(fromAsset, "USDC", normalizedAmount);
        const intermediateUsdc = roundStableAmount(
          (await waitForSpotBalance(
            client,
            "USDC",
            (available) => available > initialSpotUsdc + 0.000001,
          )) - initialSpotUsdc,
        );

        if (intermediateUsdc <= 0) {
          throw new Error(
            `No intermediate USDC became available after swapping out of ${fromAsset}.`,
          );
        }

        await placeStableLeg("USDC", toAsset, intermediateUsdc);
        return {
          fromAsset,
          toAsset,
          amount: normalizedAmount,
          message: `${toAsset} swap completed using your unified balance.`,
        };
      }

      if (fromAsset === "USDC" && toAsset !== "USDC") {
        await transferUsdcToSpot(normalizedAmount);
        await placeStableLeg("USDC", toAsset, normalizedAmount);
        return {
          fromAsset,
          toAsset,
          amount: normalizedAmount,
          message: `${toAsset} is ready in spot for HIP-3 trading.`,
        };
      }

      if (fromAsset !== "USDC" && toAsset === "USDC") {
        await placeStableLeg(fromAsset, "USDC", normalizedAmount);
        const sweepResult = await sweepUsdcToPerps();
        return {
          fromAsset,
          toAsset,
          amount: normalizedAmount,
          message: sweepResult.message,
          sweepBackAmount: sweepResult.sweepBackAmount,
          dustRemaining: sweepResult.dustRemaining,
        };
      }

      const initialSpotUsdc = roundStableAmount(
        await waitForSpotBalance(client, "USDC", (available) => available >= 0),
      );
      await placeStableLeg(fromAsset, "USDC", normalizedAmount);
      const intermediateUsdc = roundStableAmount(
        (await waitForSpotBalance(
          client,
          "USDC",
          (available) => available > initialSpotUsdc + 0.000001,
        )) - initialSpotUsdc,
      );

      if (intermediateUsdc <= 0) {
        throw new Error(
          `No intermediate USDC became available after swapping out of ${fromAsset}.`,
        );
      }

      await placeStableLeg("USDC", toAsset, intermediateUsdc);
      return {
        fromAsset,
        toAsset,
        amount: normalizedAmount,
        message: `${toAsset} swap completed in spot.`,
      };
    },
    onSuccess: () => {
      // spotBalance is a select over the userState snapshot query now.
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

export function useSwapUsdcUsdh() {
  return useStableSwap();
}

/**
 * Hook to check if builder fee is approved for the current user
 */
export function useBuilderFeeApproval() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address;

  return useQuery({
    queryKey: ["builderFeeApproval", getBuilderAddress(), walletAddress],
    queryFn: async () => {
      const fee = await client!.getMaxBuilderFee(getBuilderAddress());
      if (walletAddress) storeBuilderApproved(walletAddress, fee);
      return fee;
    },
    initialData: walletAddress
      ? getStoredBuilderApproved(walletAddress)
      : undefined,
    enabled: !!client && isBuilderConfigured(),
    // Check only once per session. Revocation mid-session surfaces via the
    // order-placement error path. See plan Fix #3.
    staleTime: Infinity,
  });
}

/**
 * Hook to approve builder fee
 */
export function useApproveBuilderFee() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Client not connected");
      return approveBuilderFeeAction(client);
    },
    onSuccess: () => {
      const fee = Math.max(1, client?.getBuilderStatus().feeTenthsBp ?? 0);
      queryClient.setQueryData(
        ["builderFeeApproval", getBuilderAddress(), walletAddress],
        fee,
      );
      if (walletAddress) storeBuilderApproved(walletAddress, fee);
      queryClient.invalidateQueries({ queryKey: ["builderFeeApproval"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
    },
  });
}

export function useRevokeBuilderFee() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Client not connected");
      return client.revokeBuilderFee();
    },
    onSuccess: () => {
      queryClient.setQueryData(
        ["builderFeeApproval", getBuilderAddress(), walletAddress],
        0,
      );
      if (walletAddress) storeBuilderApproved(walletAddress, 0);
      queryClient.invalidateQueries({ queryKey: ["builderFeeApproval"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
    },
  });
}

export function useAgentApprovalStatus() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;

  return useQuery({
    queryKey: ["agentApproval", walletAddress],
    queryFn: async () => {
      if (!client || !walletAddress) {
        throw new Error("Client not connected");
      }
      return getAgentApprovalState(
        client,
        walletAddress,
        queryClient.getQueryData(["agentApproval", walletAddress]) as
          | AgentApprovalState
          | undefined,
      );
    },
    initialData:
      client && walletAddress
        ? getLocalAgentApprovalState(client, walletAddress)
        : undefined,
    enabled: !!client && !!walletAddress,
    // Local storage makes the first render immediate, but it is not proof that
    // the exchange still authorizes this key. Always reconcile once on mount.
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    // A newly approved agent can take a moment to appear in extraAgents. Poll
    // only while that bounded grace is active; the reducer turns the state into
    // revoked-or-replaced after two minutes, which stops these checks.
    refetchInterval: (query) =>
      query.state.data?.reason === "awaiting-propagation" ? 5_000 : false,
  });
}

export function useApproveAgentTrading() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;

  return useMutation({
    mutationFn: async () => {
      if (!client || !walletAddress) throw new Error("Not connected");

      // A new key every time, never the stored one. Reauthorizing is what a
      // user does when the old key stopped working, and re-approving that same
      // key is the one outcome that cannot help. Hyperliquid also warns
      // against reusing an address it has deregistered, because the nonce
      // state that made replay impossible may already have been pruned.
      const privateKey = generateAgentKey();
      const agentAddress = getAgentAddress(privateKey);

      // Nothing is persisted until the exchange has accepted the approval, so
      // a rejected or abandoned signature leaves the previous state intact
      // rather than storing a key that was never approved.
      const { expiryMs } = await client.approveAgent(agentAddress);

      storeAgentKey(walletAddress, privateKey);
      storeAgentExpiry(walletAddress, expiryMs);
      storeAgentApprovedAt(walletAddress, Date.now());
      client.setAgentKey(privateKey);

      return { agentAddress };
    },
    onSuccess: ({ agentAddress }) => {
      clearAgentRecoveryIncident(walletAddress);
      queryClient.setQueryData(["agentApproval", walletAddress], {
        address: agentAddress,
        approved: true,
        hasLocalKey: true,
        isExpired: false,
        validUntil: null,
        state: "approved",
        reason: "awaiting-propagation",
        name: TSUNAMI_AGENT_NAME,
        approvedAt: Date.now(),
        remoteConfirmed: false,
        lastVerifiedAt: Date.now(),
        duplicateNamedAgents: 0,
      } satisfies AgentApprovalState);
      queryClient.invalidateQueries({ queryKey: ["agentApproval"] });
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
  });
}

/**
 * Revoke this account's trading authorization.
 *
 * Three outcomes, and they are not interchangeable. A signature the user
 * declined changes nothing anywhere, so the local key stays usable. A
 * confirmed replacement means the exchange no longer holds our agent. Anything
 * else — a request that failed after signing, a verification that could not be
 * read — leaves the remote side genuinely unknown, and the honest response is
 * to stop this device from signing while saying plainly that the revocation is
 * unconfirmed.
 */
export function useRevokeAgentTrading() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;

  return useMutation({
    mutationFn: async () => {
      if (!client || !walletAddress) throw new Error("Not connected");

      let remoteConfirmed = false;
      try {
        ({ remoteConfirmed } = await client.revokeAgent());
      } catch (error) {
        if (isUserRejectedSignature(error)) throw error;

        // Signed, then something went wrong. The approval may or may not have
        // landed, so the key has to stop being used either way.
        forgetAgentKey(client, walletAddress);
        throw error;
      }

      forgetAgentKey(client, walletAddress);
      return { remoteConfirmed };
    },
    onSuccess: () => {
      clearAgentRecoveryIncident(walletAddress);
      queryClient.invalidateQueries({ queryKey: ["agentApproval"] });
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["agentApproval"] });
    },
  });
}

/**
 * The trading action that was refused for lack of a valid agent, if one was.
 *
 * Subscribes to the client's incident store rather than to any one mutation,
 * because the sheet has to open from whichever screen the user was on and the
 * refusal can come from any of eleven actions. The retained incident is read
 * on mount so a screen that was still loading when the failure happened does
 * not miss it.
 */
export function useAgentRecoveryIncident() {
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address ?? null;
  const [incident, setIncident] = useState<AgentRecoveryIncident | null>(() =>
    getLastAgentRecoveryIncident(walletAddress),
  );

  useEffect(() => {
    setIncident(getLastAgentRecoveryIncident(walletAddress));
    return subscribeToAgentRecovery(setIncident, walletAddress);
  }, [walletAddress]);

  // Effects run after a render. Scope synchronously as well so account A's
  // retained raw response cannot appear for one frame after switching to B.
  const scopedIncident =
    incident &&
    walletAddress &&
    incident.accountAddress.toLowerCase() === walletAddress.toLowerCase()
      ? incident
      : null;

  // The approval query is cached for the session, so without this the app goes
  // on believing trading is authorized after the exchange has said otherwise —
  // and the order button stays lit on a key that no longer exists. Refetching
  // reconciles against the exchange and settles what is actually true.
  useEffect(() => {
    if (!scopedIncident) return;
    queryClient.invalidateQueries({ queryKey: ["agentApproval"] });
  }, [queryClient, scopedIncident]);

  const dismiss = useCallback(() => {
    clearAgentRecoveryIncident(walletAddress);
    setIncident(null);
  }, [walletAddress]);

  return { incident: scopedIncident, dismiss };
}

export function useUnifiedAccountApproval() {
  const { user } = usePrivy();
  const userStateQuery = useUserState();
  const walletAddress = user?.wallet?.address;
  const storedMode = walletAddress
    ? getStoredUnifiedMode(walletAddress)
    : undefined;

  const data = useMemo(() => {
    return getUnifiedApprovalSnapshot(userStateQuery.data, storedMode);
  }, [storedMode, userStateQuery.data]);

  useEffect(() => {
    if (walletAddress && data) {
      storeUnifiedMode(walletAddress, data.abstractionMode);
    }
  }, [data, walletAddress]);

  const refetch = useCallback(async () => {
    const result = await userStateQuery.refetch();
    const nextData = getUnifiedApprovalSnapshot(result.data, storedMode);
    if (walletAddress && nextData) {
      storeUnifiedMode(walletAddress, nextData.abstractionMode);
    }
    return {
      ...result,
      data: nextData,
    };
  }, [storedMode, userStateQuery, walletAddress]);

  return {
    ...userStateQuery,
    data,
    refetch,
  };
}

export function useSetUnifiedAccount() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!client || !walletAddress) throw new Error("Not connected");
      await client.setUserAbstraction(enabled ? "unifiedAccount" : "disabled");
      if (enabled) {
        storeUnifiedPreference(walletAddress);
      } else {
        clearUnifiedPreference(walletAddress);
      }
    },
    onSuccess: (_, enabled) => {
      const next: UnifiedApprovalState = {
        enabled,
        abstractionMode: enabled ? "unifiedAccount" : "standard",
      };
      queryClient.setQueryData(
        ["userState", "unifiedApproval", walletAddress],
        next,
      );
      if (walletAddress) storeUnifiedMode(walletAddress, next.abstractionMode);
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
  });
}

export function useHip3DexAbstractionApproval() {
  const userStateQuery = useUserState();

  return {
    ...userStateQuery,
    data: Boolean(userStateQuery.data?.hip3DexAbstractionEnabled),
  };
}

export function useSetHip3DexAbstraction() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!client) throw new Error("Client not connected");
      await client.setUserDexAbstraction(enabled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userState"] });
    },
  });
}

/**
 * Hook to set up 1-click trading via an agent wallet.
 * On first use, signs the missing prompts needed for the current trading flow.
 */
export function useSetupTrading(_target?: { isHip3?: boolean } | null) {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;
  const agentApproval = useAgentApprovalStatus();
  const builderApproval = useBuilderFeeApproval();
  const unifiedApproval = useUnifiedAccountApproval();

  useEffect(() => {
    if (
      walletAddress &&
      unifiedApproval.data?.enabled &&
      !getUnifiedPreference(walletAddress)
    ) {
      storeUnifiedPreference(walletAddress);
    }
  }, [walletAddress, unifiedApproval.data?.enabled]);

  const status = useMemo<TradingSetupStatus>(() => {
    if (!walletAddress) {
      return {
        canTrade: false,
        isChecking: false,
        isAgentExpired: false,
        needsAgentApproval: true,
        needsBuilderApproval: isBuilderConfigured(),
        needsUnifiedEnable: false,
        pendingSteps: [
          "agent",
          ...(isBuilderConfigured() ? (["builder"] as const) : []),
        ],
        blockingSteps: [
          "agent",
          ...(isBuilderConfigured() ? (["builder"] as const) : []),
        ],
        stepStates: {
          agent: "missing",
          builder: isBuilderConfigured() ? "missing" : "approved",
          unified: "approved",
        },
        shouldPromptRestoreUnified: false,
        lastVerifiedAt: null,
      };
    }

    const unifiedState =
      unifiedApproval.data ??
      ({
        enabled: false,
        abstractionMode: "standard",
      } satisfies UnifiedApprovalState);

    return buildTradingSetupStatus({
      abstractionMode: unifiedState.abstractionMode,
      prefersUnifiedAccount: getUnifiedPreference(walletAddress),
      agentApproval: agentApproval.data,
      builderMaxFee: builderApproval.data,
      builderError: builderApproval.isError,
      unifiedApproval: unifiedApproval.data,
      unifiedError: unifiedApproval.isError,
    });
  }, [
    agentApproval.data,
    builderApproval.data,
    builderApproval.isError,
    unifiedApproval.data,
    unifiedApproval.isError,
    walletAddress,
  ]);

  const refreshStatus = useCallback(async () => {
    if (!client || !walletAddress) {
      return status;
    }

    const [nextAgent, nextBuilder, nextUnified] = await Promise.all([
      agentApproval.refetch(),
      isBuilderConfigured()
        ? builderApproval.refetch()
        : Promise.resolve({ data: 1, isError: false }),
      unifiedApproval.refetch(),
    ]);

    const unifiedState =
      nextUnified.data ??
      ({
        enabled: false,
        abstractionMode: "standard",
      } satisfies UnifiedApprovalState);

    const nextStatus = buildTradingSetupStatus({
      abstractionMode: unifiedState.abstractionMode,
      prefersUnifiedAccount: getUnifiedPreference(walletAddress),
      agentApproval: nextAgent.data,
      builderMaxFee:
        typeof nextBuilder.data === "number"
          ? nextBuilder.data
          : builderApproval.data,
      builderError: Boolean(nextBuilder.isError),
      unifiedApproval: nextUnified.data,
      unifiedError: Boolean(nextUnified.isError),
    });

    return nextStatus;
  }, [
    agentApproval,
    builderApproval,
    client,
    status,
    unifiedApproval,
    walletAddress,
  ]);

  const setup = useMutation({
    mutationFn: async () => {
      if (!client || !walletAddress) throw new Error("Not connected");

      const currentStatus = status.isChecking ? await refreshStatus() : status;
      let privateKey = getStoredAgentKey(walletAddress);

      if (currentStatus.needsAgentApproval) {
        // Always a new key when an approval is needed — see
        // useApproveAgentTrading for why reusing the stored one is the one
        // thing that cannot fix a key the exchange has stopped accepting.
        privateKey = generateAgentKey();
        const agentAddress = getAgentAddress(privateKey);
        const { expiryMs } = await client.approveAgent(agentAddress);
        storeAgentKey(walletAddress, privateKey);
        storeAgentExpiry(walletAddress, expiryMs);
        storeAgentApprovedAt(walletAddress, Date.now());
        client.setAgentKey(privateKey);
        queryClient.setQueryData(["agentApproval", walletAddress], {
          address: agentAddress,
          approved: true,
          hasLocalKey: true,
          isExpired: false,
          validUntil: expiryMs,
          state: "approved",
          reason: "awaiting-propagation",
          name: TSUNAMI_AGENT_NAME,
          approvedAt: Date.now(),
          remoteConfirmed: false,
          lastVerifiedAt: Date.now(),
          duplicateNamedAgents: 0,
        } satisfies AgentApprovalState);
      } else if (privateKey && !client.hasAgentKey()) {
        client.setAgentKey(privateKey);
      }

      if (currentStatus.needsBuilderApproval && isBuilderConfigured()) {
        await approveBuilderFeeAction(client);
        const fee = Math.max(1, client.getBuilderStatus().feeTenthsBp);
        queryClient.setQueryData(
          ["builderFeeApproval", getBuilderAddress(), walletAddress],
          fee,
        );
        storeBuilderApproved(walletAddress, fee);
      }

      if (currentStatus.needsUnifiedEnable) {
        await client.setUserAbstraction("unifiedAccount");
        storeUnifiedPreference(walletAddress);
        queryClient.setQueryData(
          ["userState", "unifiedApproval", walletAddress],
          {
            enabled: true,
            abstractionMode: "unifiedAccount",
          } satisfies UnifiedApprovalState,
        );
        storeUnifiedMode(walletAddress, "unifiedAccount");
      }
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["agentApproval"] });
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      // spotBalance is a select over the userState snapshot query now.
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["builderFeeApproval"] });
    },
  });

  return {
    status,
    isReady: status.canTrade,
    isExpired: status.isAgentExpired,
    refreshStatus,
    setup,
  };
}

// WebSocket Hooks

/**
 * Hook to subscribe to real-time orderbook updates
 */
export function useOrderbookWs(coin: string) {
  const { client } = usePublicHyperliquid();
  const [orderbook, setOrderbook] = useState<any>(null);

  useEffect(() => {
    if (!coin) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToOrderbook(coin, (data: WsMessage) => {
        if (data.channel === "l2Book") {
          setOrderbook(data.data);
        }
      });
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [client, coin]);

  return orderbook;
}

/**
 * Hook to subscribe to real-time trades
 */
export function useTradesWs(coin: string) {
  const { client } = usePublicHyperliquid();
  const [trades, setTrades] = useState<any[]>([]);

  useEffect(() => {
    if (!coin) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToTrades(coin, (data: WsMessage) => {
        if (data.channel === "trades") {
          setTrades((prev) => [...data.data, ...prev].slice(0, 100)); // Keep last 100 trades
        }
      });
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [client, coin]);

  return trades;
}

/**
 * Hook to subscribe to real-time candle updates
 */
export function useCandlesWs(coin: string, interval: string = "1m") {
  const { client } = usePublicHyperliquid();
  const [candle, setCandle] = useState<any>(null);

  useEffect(() => {
    if (!coin) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToCandles(
        coin,
        interval,
        (data: WsMessage) => {
          if (data.channel === "candle") {
            setCandle(data.data);
          }
        },
      );
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [client, coin, interval]);

  return candle;
}

/**
 * Hook to subscribe to real-time user events
 */
export function useUserEventsWs() {
  const { client } = useHyperliquid();
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!client) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToUserEvents((data: WsMessage) => {
        setEvents((prev) => [data, ...prev].slice(0, 50)); // Keep last 50 events
      });
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [client]);

  return events;
}

/**
 * Hook to subscribe to real-time mid prices
 */
export function useMidsWs() {
  const { client } = usePublicHyperliquid();
  const [mids, setMids] = useState<Record<string, string>>({});

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToAllMids((data: WsMessage) => {
        if (data.channel === "allMids") {
          setMids(data.data);
        }
      });
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [client]);

  return mids;
}

/**
 * Hook to manage WebSocket connection
 */
export function useWebSocket() {
  const { client } = usePublicHyperliquid();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialise from current state, then subscribe to future changes.
    setIsConnected(client.isWsConnected());
    const unsubscribe = client.onWsStatusChange(setIsConnected);
    return unsubscribe;
  }, [client]);

  const connect = useCallback(async () => {
    if (client) {
      await client.connectWs();
      setIsConnected(true);
    }
  }, [client]);

  const disconnect = useCallback(() => {
    if (client) {
      client.disconnectWs();
      setIsConnected(false);
    }
  }, [client]);

  return { isConnected, connect, disconnect };
}

/**
 * Hook to fetch market stats (24h vol, price change, OI, funding) for all perp assets.
 * Data is extracted from the already-fetched metaAndAssetCtxs response — zero additional network cost on first call.
 */
export function useMarketStats() {
  return useQuery<Record<string, MarketStats>>({
    queryKey: ["marketStats"],
    queryFn: () => fetchEdgeMarketStats(),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/**
 * Hook to fetch asset context for a single coin (OI, funding, 24h vol, mark price).
 */
export function useAssetCtx(coin: string) {
  return useQuery<AssetCtx | null>({
    queryKey: ["assetCtx", coin],
    queryFn: () => fetchEdgeAssetCtx(coin),
    enabled: !!coin,
    // No placeholderData: coin-scoped, see useMarketPrice.
    staleTime: 30_000,
  });
}

/**
 * Hook to fetch portfolio value history for area chart display.
 */
export function usePortfolioPeriod(period: PortfolioRange = "7d") {
  const getAccessToken = useAccountToken();
  const scope = useAccountScope();

  return useQuery<PortfolioPeriodData>({
    queryKey: ["portfolioPeriod", period, scope],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }
      return fetchAccountPortfolio(accessToken, period);
    },
    enabled: Boolean(scope),
    staleTime: 60_000,
  });
}

export function usePortfolioHistory(period: PortfolioRange = "7d") {
  const getAccessToken = useAccountToken();
  const scope = useAccountScope();

  return useQuery<PortfolioHistoryPoint[]>({
    queryKey: ["portfolioHistory", period, scope],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }
      return (await fetchAccountPortfolio(accessToken, period))
        .accountValueHistory;
    },
    enabled: Boolean(scope),
    staleTime: 60_000,
  });
}
