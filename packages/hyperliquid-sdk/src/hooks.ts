import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useRef, useState, useCallback } from 'react';
import { HyperliquidClient } from './client';
import type { Order, WsMessage } from '@repo/types';

// Create a singleton client instance
let clientInstance: HyperliquidClient | null = null;

function getClient(walletAddress: string, customSigner?: unknown, testnet?: boolean): HyperliquidClient {
  if (!clientInstance || clientInstance['walletAddress'] !== walletAddress) {
    clientInstance = new HyperliquidClient({
      walletAddress,
      customSigner,
      testnet,
    });
  }
  return clientInstance;
}

/**
 * Hook to get the Hyperliquid client instance
 */
export function useHyperliquid() {
  const { user, getEthereumProvider } = usePrivy();
  const provider = getEthereumProvider();
  const testnet = import.meta.env.VITE_HYPERLIQUID_TESTNET === 'true';

  if (!user?.wallet?.address) {
    return { client: null, isConnected: false };
  }

  const client = getClient(user.wallet.address, provider, testnet);
  return { client, isConnected: true };
}

/**
 * Hook to fetch market data
 */
export function useMarketData() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['markets'],
    queryFn: () => client?.getMarkets(),
    enabled: !!client,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch all mid prices
 */
export function useMids() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['mids'],
    queryFn: () => client?.getMids(),
    enabled: !!client,
    refetchInterval: 2000, // Refetch every 2 seconds
  });
}

/**
 * Hook to fetch orderbook
 */
export function useOrderbook(coin: string) {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['orderbook', coin],
    queryFn: () => client?.getOrderbook(coin),
    enabled: !!client && !!coin,
    refetchInterval: 1000, // Refetch every second
  });
}

/**
 * Hook to fetch candles
 */
export function useCandles(coin: string, interval: string = '1h') {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['candles', coin, interval],
    queryFn: () => client?.getCandles(coin, interval),
    enabled: !!client && !!coin,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to fetch user state (positions, margin, etc.)
 */
export function useUserState() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['userState'],
    queryFn: () => client?.getUserState(),
    enabled: !!client,
    refetchInterval: 5000, // Refetch every 5 seconds
  });
}

/**
 * Hook to place an order
 */
export function usePlaceOrder() {
  const { client } = useHyperliquid();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: Order) => {
      if (!client) throw new Error('Client not connected');
      return client.placeOrder(order);
    },
    onSuccess: () => {
      // Invalidate user state to refresh positions/orders
      queryClient.invalidateQueries({ queryKey: ['userState'] });
      queryClient.invalidateQueries({ queryKey: ['openOrders'] });
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
      if (!client) throw new Error('Client not connected');
      return client.cancelOrder(coin, oid);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userState'] });
      queryClient.invalidateQueries({ queryKey: ['openOrders'] });
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
      if (!client) throw new Error('Client not connected');
      return client.cancelAllOrders(coin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userState'] });
      queryClient.invalidateQueries({ queryKey: ['openOrders'] });
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
      if (!client) throw new Error('Client not connected');
      return client.modifyOrder(oid, order);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userState'] });
      queryClient.invalidateQueries({ queryKey: ['openOrders'] });
    },
  });
}

/**
 * Hook to fetch open orders
 */
export function useOpenOrders() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['openOrders'],
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
    queryKey: ['fills'],
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
    queryKey: ['historicalOrders'],
    queryFn: () => client?.getHistoricalOrders(),
    enabled: !!client,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to fetch funding history
 */
export function useFundingHistory(coin: string, startTime?: number) {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['fundingHistory', coin, startTime],
    queryFn: () => client?.getFundingHistory(coin, startTime),
    enabled: !!client && !!coin,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch predicted funding rates
 */
export function usePredictedFundingRates() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['predictedFundingRates'],
    queryFn: () => client?.getPredictedFundingRates(),
    enabled: !!client,
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
    mutationFn: ({ coin, leverage, isCross = true }: { coin: string; leverage: number; isCross?: boolean }) => {
      if (!client) throw new Error('Client not connected');
      return client.updateLeverage(coin, leverage, isCross);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userState'] });
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
      if (!client) throw new Error('Client not connected');
      return client.updateIsolatedMargin(coin, amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userState'] });
    },
  });
}

/**
 * Hook to fetch portfolio
 */
export function usePortfolio() {
  const { client } = useHyperliquid();

  return useQuery({
    queryKey: ['portfolio'],
    queryFn: () => client?.getPortfolio(),
    enabled: !!client,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// WebSocket Hooks

/**
 * Hook to subscribe to real-time orderbook updates
 */
export function useOrderbookWs(coin: string) {
  const { client } = useHyperliquid();
  const [orderbook, setOrderbook] = useState<any>(null);

  useEffect(() => {
    if (!client || !coin) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToOrderbook(coin, (data: WsMessage) => {
        if (data.channel === 'l2Book') {
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
  const { client } = useHyperliquid();
  const [trades, setTrades] = useState<any[]>([]);

  useEffect(() => {
    if (!client || !coin) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToTrades(coin, (data: WsMessage) => {
        if (data.channel === 'trades') {
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
export function useCandlesWs(coin: string, interval: string = '1m') {
  const { client } = useHyperliquid();
  const [candle, setCandle] = useState<any>(null);

  useEffect(() => {
    if (!client || !coin) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToCandles(coin, interval, (data: WsMessage) => {
        if (data.channel === 'candle') {
          setCandle(data.data);
        }
      });
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
  const { client } = useHyperliquid();
  const [mids, setMids] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!client) return;

    let unsubscribe: (() => void) | undefined;

    const setupSubscription = async () => {
      await client.connectWs();
      unsubscribe = client.subscribeToAllMids((data: WsMessage) => {
        if (data.channel === 'allMids') {
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
  const { client } = useHyperliquid();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!client) return;

    const checkConnection = () => {
      setIsConnected(client.isWsConnected());
    };

    // Check connection status periodically
    const interval = setInterval(checkConnection, 1000);

    return () => {
      clearInterval(interval);
    };
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
