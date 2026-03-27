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
  usePlaceSpotOrder,
  useClosePosition,
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
  useSwapUsdcUsdh,
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
  getBuilderConfig,
  isBuilderFeeApproved,
  isBuilderConfigured,
  feeToPercentString,
  BUILDER_ADDRESS,
  BUILDER_FEE_TENTHS_BP,
  ZERO_ADDRESS,
} from './builder';

// Market classification
export {
  classifyMarket,
  getMarketTags,
  enrichMarkets,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from './market-categories';

// WebSocket manager
export { WebSocketManager } from './ws';
