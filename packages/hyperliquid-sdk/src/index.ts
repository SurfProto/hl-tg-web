// Main exports
export { HyperliquidClient } from "./client";
export type { HyperliquidClientConfig } from "./client";
// Dynamic-import pre-warm loaders. Call these fire-and-forget at app bootstrap
// so the @nktkas/hyperliquid chunk is parsed before the first order.
export { loadHyperliquidSDK, loadHyperliquidSigning } from "./client";
export {
  formatOrderSize,
  inferSzDecimalsFromMinBaseSize,
  validateOrderInput,
} from "./order-validation";
export type { OrderValidationMarket } from "./order-validation";
// The one sanctioned way to cut a money amount to a decimal budget. Never
// rounds upwards — a "Max" built on toFixed offered users more than they had.
export { truncateToDecimals } from "./decimal";
export {
  fetchAccountFills,
  fetchAccountOrders,
  fetchAccountPortfolio,
  fetchAccountSnapshot,
  fetchEdgeAssetCtx,
  fetchEdgeCandles,
  fetchEdgeMarketPrice,
  fetchEdgeMarketStats,
  fetchEdgeMarkets,
  fetchEdgeMids,
  fetchEdgeOrderbook,
} from "./edge-proxy";
export type { AccountSnapshot } from "./edge-proxy";

// Hooks
export {
  useHyperliquid,
  useMarketData,
  useMids,
  useMarketPrice,
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
  useUserFees,
  usePortfolio,
  // Spot hooks — kept for SwapPage / TransferPage (unrouted, re-enable later)
  useSpotBalance,
  useUsdClassTransfer,
  useStableSwap,
  useSwapUsdcUsdh,
  useWithdraw,
  useArbitrumUsdcBalance,
  useFundArbitrumUsdc,
  useBridgeToHyperliquid,
  // Builder fee hooks
  useBuilderFeeApproval,
  useApproveBuilderFee,
  useRevokeBuilderFee,
  useAgentApprovalStatus,
  useApproveAgentTrading,
  useRevokeAgentTrading,
  useAgentRecoveryIncident,
  useUnifiedAccountApproval,
  useSetUnifiedAccount,
  useHip3DexAbstractionApproval,
  useSetHip3DexAbstraction,
  // Agent wallet / 1-click trading
  useSetupTrading,
  // Market stats hooks
  useMarketStats,
  useAssetCtx,
  usePortfolioPeriod,
  usePortfolioHistory,
  SUPPORTED_STABLE_SWAP_ASSETS,
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
  AGENT_APPROVAL_WINDOW_MS,
  TSUNAMI_AGENT_NAME,
  buildAgentName,
  generateAgentKey,
  getAgentAddress,
  getStoredAgentKey,
  isTsunamiAgentName,
  storeAgentKey,
  clearStoredAgentKey,
} from "./agent";

// Trading authorization failures and the recovery they trigger
export {
  AgentAuthorizationError,
  isAgentAuthorizationError,
  isUserRejectedSignature,
  maskAddress,
  redactAddresses,
} from "./exchange-response";
export {
  clearAgentRecoveryIncident,
  getLastAgentRecoveryIncident,
  reportAgentRecoveryIncident,
  subscribeToAgentRecovery,
} from "./agent-recovery";
export type { AgentRecoveryIncident } from "./agent-recovery";
export {
  AGENT_PROPAGATION_GRACE_MS,
  reduceAgentApproval,
} from "./trading-setup";
export type { AgentApprovalState } from "./trading-setup";

// Shared constants (chain addresses, IDs)
export {
  USDC_ARBITRUM,
  HL_BRIDGE_ARBITRUM,
  ARBITRUM_CHAIN_ID,
} from "./constants";

// Who pays the gas on a deposit
export { configureGasSponsorship, isDepositGasSponsored } from "./gas-sponsorship";

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
export {
  evaluateTradingSetupStatus,
  combineStableBalances,
  getActionableBalances,
  getAvailableCollateralForMarket,
  getSupportedStableAssets,
  getVisibleStableBalances,
  inferAbstractionMode,
  normalizePerpStableBalance,
  normalizeStableBalances,
} from "./account-state";

export {
  classifyProtectionOrder,
  planPositionProtection,
} from "./position-protection";
export type {
  PositionDirection,
  ProtectionKind,
  ProtectionPlan,
} from "./position-protection";

// WebSocket manager
export { WebSocketManager } from "./ws";
