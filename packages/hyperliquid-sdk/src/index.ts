// Main exports
export { HyperliquidClient } from './client';
export type { HyperliquidClientConfig } from './client';
export {
  formatOrderSize,
  inferSzDecimalsFromMinBaseSize,
  validateOrderInput,
} from './order-validation';
export type { OrderValidationMarket } from './order-validation';

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
  useFundArbitrumUsdc,
  useBridgeToHyperliquid,
  useSwapUsdcUsdh,
  // Builder fee hooks
  useBuilderFeeApproval,
  useApproveBuilderFee,
  // Agent wallet / 1-click trading
  useSetupTrading,
  // Market stats hooks
  useMarketStats,
  useAssetCtx,
  usePortfolioHistory,
  // WebSocket hooks
  useOrderbookWs,
  useTradesWs,
  useCandlesWs,
  useUserEventsWs,
  useMidsWs,
  useWebSocket,
} from './hooks';

// Agent wallet helpers
export {
  generateAgentKey,
  getAgentAddress,
  getStoredAgentKey,
  storeAgentKey,
  clearAgentKey,
} from './agent';

// Shared constants (chain addresses, IDs)
export { USDC_ARBITRUM, HL_BRIDGE_ARBITRUM, ARBITRUM_CHAIN_ID } from './constants';

// Builder code
export {
  configureBuilder,
  approveBuilderFee,
  getBuilderConfig,
  getBuilderAddress,
  getBuilderFeeTenthsBp,
  isBuilderFeeApproved,
  isBuilderConfigured,
  feeToPercentString,
} from './builder';

// Market classification
export {
  classifyMarket,
  getMarketTags,
  enrichMarkets,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from './market-categories';
export {
  getMarketDisplayName,
  getMarketBaseAsset,
  getMarketSearchTerms,
} from './market-display';

// WebSocket manager
export { WebSocketManager } from './ws';
