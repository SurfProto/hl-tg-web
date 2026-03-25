// Main exports
export { HyperliquidClient } from './client';
export type { HyperliquidClientConfig } from './client';

// Hooks
export {
  useHyperliquid,
  useMarketData,
  useMids,
  useOrderbook,
  useCandles,
  useUserState,
  usePlaceOrder,
  useCancelOrder,
  useCancelAllOrders,
  useModifyOrder,
  useOpenOrders,
  useFills,
  useHistoricalOrders,
  useFundingHistory,
  usePredictedFundingRates,
  useUpdateLeverage,
  useUpdateIsolatedMargin,
  usePortfolio,
  useSpotBalance,
  useUsdClassTransfer,
  useWithdraw,
  useArbitrumUsdcBalance,
  useBridgeToHyperliquid,
  // Builder fee hooks
  useBuilderFeeApproval,
  useApproveBuilderFee,
  // WebSocket hooks
  useOrderbookWs,
  useTradesWs,
  useCandlesWs,
  useUserEventsWs,
  useMidsWs,
  useWebSocket,
} from './hooks';

// Builder code
export {
  approveBuilderFee,
  injectBuilderCode,
  isBuilderFeeApproved,
  feeToPercentString,
  BUILDER_ADDRESS,
  BUILDER_FEE_TENTHS_BP,
} from './builder';

// WebSocket manager
export { WebSocketManager } from './ws';
