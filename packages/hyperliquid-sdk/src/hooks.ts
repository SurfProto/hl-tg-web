import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useFundWallet,
  usePrivy,
  useSendTransaction,
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
  generateAgentKey,
  getAgentAddress,
  getStoredAgentKey,
  storeAgentKey,
  storeAgentExpiry,
  isAgentKeyExpired,
} from "./agent";
import {
  evaluateTradingSetupStatus,
  getSupportedStableAssets,
} from "./account-state";
import type {
  AccountState,
  AssetCtx,
  MarketStats,
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

const publicClientCache = new Map<"mainnet" | "testnet", HyperliquidClient>();
const STABLE_SWAP_ASSETS = getSupportedStableAssets();
const STABLE_TRANSFER_PRECISION = 1_000_000;
const SPOT_USDC_DUST_THRESHOLD = 0.01;
const UNIFIED_ACCOUNT_PREFERENCE_PREFIX = "hl_pref_unified_";

type StableSpotMarket = {
  index: number;
  baseName: string;
  quoteName: string;
};

type ResolvedStableSwapLeg = {
  coin: string;
  side: "buy" | "sell";
  marketName: string;
};

function roundStableAmount(amount: number) {
  return (
    Math.floor(amount * STABLE_TRANSFER_PRECISION) / STABLE_TRANSFER_PRECISION
  );
}

function formatStableAmount(amount: number) {
  return roundStableAmount(amount)
    .toFixed(6)
    .replace(/\.?0+$/, "");
}

function parseBalanceAmount(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSpotAvailableBalance(spotBalance: any, coin: StableSwapAsset) {
  const entry = spotBalance?.balances?.find(
    (balance: any) => balance.coin?.toUpperCase() === coin,
  );
  if (!entry) return 0;
  const total = parseBalanceAmount(entry.total);
  const hold = parseBalanceAmount(entry.hold);
  return Math.max(0, total - hold);
}

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

function resolveStableSwapLeg(
  markets: StableSpotMarket[],
  fromAsset: StableSwapAsset,
  toAsset: StableSwapAsset,
): ResolvedStableSwapLeg {
  const buyLeg = markets.find(
    (market) =>
      market.baseName.toUpperCase() === toAsset &&
      market.quoteName.toUpperCase() === fromAsset,
  );
  if (buyLeg) {
    return {
      coin: `@${buyLeg.index}`,
      side: "buy",
      marketName: `${buyLeg.baseName}/${buyLeg.quoteName}`,
    };
  }

  const sellLeg = markets.find(
    (market) =>
      market.baseName.toUpperCase() === fromAsset &&
      market.quoteName.toUpperCase() === toAsset,
  );
  if (sellLeg) {
    return {
      coin: `@${sellLeg.index}`,
      side: "sell",
      marketName: `${sellLeg.baseName}/${sellLeg.quoteName}`,
    };
  }

  throw new Error(
    `No supported spot market found for ${fromAsset} -> ${toAsset}.`,
  );
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
 * Hook to get the Hyperliquid client instance.
 * Instance is memoized by (walletAddress, provider, testnet) — a new client is
 * created only when one of those changes (e.g. logout → login as a different user).
 * Agent key restoration is deferred to a useEffect so it never runs during render.
 */
export function useHyperliquid() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const [provider, setProvider] = useState<unknown>(null);
  const testnet = import.meta.env.VITE_HYPERLIQUID_TESTNET === "true";
  const walletAddress = user?.wallet?.address ?? null;

  // getEthereumProvider() is async on ConnectedWallet — resolve it once and store
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  useEffect(() => {
    if (!embeddedWallet) return;
    embeddedWallet.getEthereumProvider().then(setProvider);
  }, [embeddedWallet]);

  const client = useMemo(() => {
    if (!walletAddress) return null;
    return new HyperliquidClient({
      masterAccountAddress: walletAddress,
      walletAddress,
      customSigner: provider ?? undefined,
      testnet,
    });
  }, [walletAddress, provider, testnet]);

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

/**
 * Hook to fetch market data
 */
export function useMarketData() {
  const { client } = usePublicHyperliquid();

  return useQuery({
    queryKey: ["markets"],
    queryFn: () => client.getMarkets(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch all mid prices
 */
export function useMids() {
  const { client } = usePublicHyperliquid();

  return useQuery({
    queryKey: ["mids"],
    queryFn: () => client.getMids(),
    refetchInterval: 4000, // Refetch every 4 seconds
  });
}

/**
 * Hook to fetch orderbook
 */
export function useOrderbook(coin: string) {
  const { client } = usePublicHyperliquid();

  return useQuery({
    queryKey: ["orderbook", coin],
    queryFn: () => client.getOrderbook(coin),
    enabled: !!coin,
    refetchInterval: 2000, // Refetch every 2 seconds
  });
}

/**
 * Hook to fetch candles
 */
export function useCandles(coin: string, interval: string = "1h") {
  const { client } = usePublicHyperliquid();

  return useQuery({
    queryKey: ["candles", coin, interval],
    queryFn: () => client.getCandles(coin, interval),
    enabled: !!coin,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to fetch user state (positions, margin, etc.)
 */
export function useUserState() {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address ?? null;
  const prefersUnifiedAccount =
    walletAddress != null ? getUnifiedPreference(walletAddress) : false;

  const query = useQuery({
    queryKey: ["userState"],
    queryFn: () => client?.getUserState(),
    enabled: !!client,
    refetchInterval: 5000, // Refetch every 5 seconds
  });

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
      queryClient.invalidateQueries({ queryKey: ["spotBalance"] });
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
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
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
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
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
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
      queryClient.invalidateQueries({ queryKey: ["fills"] });
    },
  });
}

/**
 * Hook to cancel an order
 */
export function useCancelOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ coin, oid }: { coin: string; oid: number }) => {
      if (!client) throw new Error("Client not connected");
      return client.cancelOrder(coin, oid);
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
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ["openOrders"],
    queryFn: () => client?.getOpenOrders(),
    enabled: !!client,
    refetchInterval: 5000,
  });
}

/**
 * Hook to fetch fills
 */
export function useFills() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ["fills"],
    queryFn: () => client?.getFills(),
    enabled: !!client,
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
 * Hook to fetch spot account balance (HL L1 spot)
 */
export function useSpotBalance() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ["spotBalance"],
    queryFn: () => client?.getSpotBalance(),
    enabled: !!client,
    refetchInterval: 5000,
  });
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
      queryClient.invalidateQueries({ queryKey: ["spotBalance"] });
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
      queryClient.invalidateQueries({ queryKey: ["spotBalance"] });
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

  return useQuery({
    queryKey: ["builderFeeApproval", getBuilderAddress()],
    queryFn: () => client!.getMaxBuilderFee(getBuilderAddress()),
    enabled: !!client && isBuilderConfigured(),
    staleTime: 1000 * 60 * 5, // 5 minutes - approval doesn't change often
  });
}

/**
 * Hook to approve builder fee
 */
export function useApproveBuilderFee() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Client not connected");
      return approveBuilderFeeAction(client);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["builderFeeApproval"] });
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
    },
  });
}

/**
 * Hook to set up 1-click trading via an agent wallet.
 * On first use, signs the missing prompts needed for the current trading flow.
 */
export function useSetupTrading(target?: { isHip3?: boolean } | null) {
  const { client } = useHyperliquid();
  const { user } = usePrivy();
  const queryClient = useQueryClient();
  const walletAddress = user?.wallet?.address;
  const isKeyValid = (address: string) =>
    getStoredAgentKey(address) !== null && !isAgentKeyExpired(address);

  const isKeyExpired = (address: string) =>
    getStoredAgentKey(address) !== null && isAgentKeyExpired(address);

  const defaultStatus: TradingSetupStatus = useMemo(
    () => ({
      canTrade: false,
      isAgentExpired: false,
      needsAgentApproval: true,
      needsBuilderApproval: isBuilderConfigured(),
      needsHip3AbstractionEnable: Boolean(target?.isHip3),
      needsUnifiedEnable: false,
      shouldPromptRestoreUnified: false,
    }),
    [target?.isHip3],
  );
  const [status, setStatus] = useState<TradingSetupStatus>(defaultStatus);

  const refreshStatus = useCallback(async () => {
    if (!client || !walletAddress) {
      setStatus(defaultStatus);
      return defaultStatus;
    }

    const hasAgentKey = isKeyValid(walletAddress);
    const expired = isKeyExpired(walletAddress);
    const [accountState, builderMaxFee] = await Promise.all([
      client.getUserState(),
      isBuilderConfigured()
        ? client.getMaxBuilderFee(getBuilderAddress())
        : Promise.resolve(1),
    ]);

    let prefersUnifiedAccount = getUnifiedPreference(walletAddress);
    if (
      accountState.abstractionMode === "unifiedAccount" &&
      !prefersUnifiedAccount
    ) {
      storeUnifiedPreference(walletAddress);
      prefersUnifiedAccount = true;
    }

    const nextStatus = evaluateTradingSetupStatus({
      hasAgentKey,
      isAgentExpired: expired,
      abstractionMode: accountState.abstractionMode,
      prefersUnifiedAccount,
      needsBuilderApproval: isBuilderConfigured() && builderMaxFee <= 0,
      targetIsHip3: Boolean(target?.isHip3),
      hip3DexAbstractionEnabled: accountState.hip3DexAbstractionEnabled,
    });

    setStatus(nextStatus);
    return nextStatus;
  }, [client, defaultStatus, target?.isHip3, walletAddress]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const setup = useMutation({
    mutationFn: async () => {
      if (!client || !walletAddress) throw new Error("Not connected");

      const currentStatus = await refreshStatus();
      let privateKey = getStoredAgentKey(walletAddress);

      if (currentStatus.needsAgentApproval) {
        privateKey = generateAgentKey();
        const agentAddress = getAgentAddress(privateKey);
        const { expiryMs } = await client.approveAgent(agentAddress);
        storeAgentExpiry(walletAddress, expiryMs);
        storeAgentKey(walletAddress, privateKey);
        client.setAgentKey(privateKey);
      } else if (privateKey && !client.hasAgentKey()) {
        client.setAgentKey(privateKey);
      }

      if (currentStatus.needsBuilderApproval && isBuilderConfigured()) {
        await approveBuilderFeeAction(client);
      }

      if (currentStatus.needsUnifiedEnable) {
        await client.setUserAbstraction("unifiedAccount");
        storeUnifiedPreference(walletAddress);
      }

      if (currentStatus.needsHip3AbstractionEnable) {
        await client.setUserDexAbstraction(true);
      }
    },
    onSuccess: async () => {
      await refreshStatus();
      queryClient.invalidateQueries({ queryKey: ["userState"] });
      queryClient.invalidateQueries({ queryKey: ["spotBalance"] });
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
  const { client } = usePublicHyperliquid();

  return useQuery<Record<string, MarketStats>>({
    queryKey: ["marketStats"],
    queryFn: () => client.getMarketStats(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/**
 * Hook to fetch asset context for a single coin (OI, funding, 24h vol, mark price).
 */
export function useAssetCtx(coin: string) {
  const { client } = usePublicHyperliquid();

  return useQuery<AssetCtx | null>({
    queryKey: ["assetCtx", coin],
    queryFn: () => client.getAssetCtx(coin),
    enabled: !!coin,
    staleTime: 30_000,
  });
}

/**
 * Hook to fetch portfolio value history for area chart display.
 */
export function usePortfolioPeriod(period: PortfolioRange = "7d") {
  const { client } = useHyperliquid();

  return useQuery<PortfolioPeriodData>({
    queryKey: ["portfolioPeriod", period],
    queryFn: () => {
      if (!client) throw new Error("Client not connected");
      return client.getPortfolioPeriod(period);
    },
    enabled: !!client,
    staleTime: 60_000,
  });
}

export function usePortfolioHistory(period: PortfolioRange = "7d") {
  const { client } = useHyperliquid();

  return useQuery<PortfolioHistoryPoint[]>({
    queryKey: ["portfolioHistory", period],
    queryFn: () => {
      if (!client) throw new Error("Client not connected");
      return client.getPortfolioHistory(period);
    },
    enabled: !!client,
    staleTime: 60_000,
  });
}
