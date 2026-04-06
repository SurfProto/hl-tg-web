// Main exports
export { HyperliquidClient } from "./client";
export type { HyperliquidClientConfig } from "./client";
export {
  formatOrderSize,
  inferSzDecimalsFromMinBaseSize,
  validateOrderInput,
} from "./order-validation";
export type { OrderValidationMarket } from "./order-validation";

// Hooks
export {
  useHyperliquid,
  useMarketData,
  useMids,
  useOrderbook,
  useCandles,
  useUserState,
  usePlaceOrder,
  // usePlaceSpotOrder — kept in hooks.ts, not exported (spot disabled)
  usePlaceTriggerOrder,
  useUpsertPositionProtection,
  useCancelPositionProtection,
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
  // Spot hooks — kept for SwapPage / TransferPage (unrouted, re-enable later)
  useSpotBalance,
  useUsdClassTransfer,
  useSwapUsdcUsdh,
  useWithdraw,
  useArbitrumUsdcBalance,
  useFundArbitrumUsdc,
  useBridgeToHyperliquid,
  // Builder fee hooks
  useBuilderFeeApproval,
  useApproveBuilderFee,
  // Agent wallet / 1-click trading
  useSetupTrading,
  // Market stats hooks
  useMarketStats,
  useAssetCtx,
  usePortfolioPeriod,
  usePortfolioHistory,
  // WebSocket hooks
  useOrderbookWs,
  useTradesWs,
  useCandlesWs,
  useUserEventsWs,
  useMidsWs,
  useWebSocket,
} from "./hooks";

// Agent wallet helpers
export {
  generateAgentKey,
  getAgentAddress,
  getStoredAgentKey,
  storeAgentKey,
  clearAgentKey,
} from "./agent";

// Shared constants (chain addresses, IDs)
export {
  USDC_ARBITRUM,
  HL_BRIDGE_ARBITRUM,
  ARBITRUM_CHAIN_ID,
} from "./constants";

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
} from "./builder";

// Market classification
export {
  classifyMarket,
  getMarketTags,
  getMarketSubCategory,
  enrichMarkets,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COIN_SUBCATEGORY_MAP,
  SUB_FILTERS,
} from "./market-categories";
export type { SubFilterConfig } from "./market-categories";
export {
  getMarketDisplayName,
  getMarketBaseAsset,
  getMarketSearchTerms,
} from "./market-display";

// WebSocket manager
export { WebSocketManager } from "./ws";
