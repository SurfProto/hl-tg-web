// Market types
export interface Market {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
  isDelisted: boolean;
  minNotionalUsd: number;
  minBaseSize: number;
  dex?: string;
  dexIndex?: number;
  isHip3?: boolean;
}

export interface SpotMarket extends Market {
  type: "spot";
  tokens: [number, number];
  index: number;
  baseName: string;
  quoteName: string;
}

export interface PerpMarket extends Market {
  type: "perp";
  index: number;
}

export type AnyMarket = SpotMarket | PerpMarket;

// Market classification types
export type MarketCategory =
  | "all"
  | "perps"
  | "spot"
  | "crypto"
  | "tradfi"
  | "trending"
  | "prelaunch";
export type MarketTag = "PERP" | "SPOT" | "TRADFI" | "CASH";
export type MarketSubCategory =
  | "stocks"
  | "indices"
  | "commodities"
  | "fx"
  | "pre-ipo"
  | "ai"
  | "defi"
  | "gaming"
  | "layer1"
  | "layer2"
  | "meme"
  | "usdc"
  | "usdh"
  | "usdt";

export interface EnrichedMarket {
  market: AnyMarket;
  categories: MarketCategory[];
  tags: MarketTag[];
  subCategory?: MarketSubCategory;
}

// Order types
export type OrderType = "market" | "limit";
export type OrderSide = "buy" | "sell";
export type MarketType = "perp" | "spot";
export type TriggerOrderKind = "stopLoss" | "takeProfit";
export type StableSwapAsset = "USDC" | "USDH" | "USDT" | "USDE";
export type AccountAbstractionMode =
  | "standard"
  | "unifiedAccount"
  | "portfolioMargin"
  | "dexAbstraction"
  | "unknown";
export type ApprovalRequirementState =
  | "checking"
  | "approved"
  | "missing"
  | "stale";

/**
 * Why trading is or is not authorized, as opposed to whether it is.
 *
 * `ApprovalRequirementState` answers the question the order button asks and
 * collapses every failure into "missing". These are the distinctions a user
 * needs to act: a key that was never created, one that ran out, one another
 * device replaced, one too new to have appeared yet, one we could not check,
 * and one the exchange refused mid-trade despite looking valid.
 */
export type AgentAuthorizationReason =
  | "active"
  | "missing-local-key"
  | "expired"
  | "revoked-or-replaced"
  | "remote-only"
  | "awaiting-propagation"
  | "verification-unavailable"
  | "signature-rejected";
export type TradingSetupStep = "agent" | "builder" | "unified";

export interface StableBalanceState {
  total: number;
  hold: number;
  available: number;
  spot?: {
    total: number;
    hold: number;
    available: number;
  };
  perp?: {
    total: number;
    hold: number;
    available: number;
  };
}

export interface VisibleStableBalance extends StableBalanceState {
  asset: StableSwapAsset;
}

export interface TradingSetupStatus {
  canTrade: boolean;
  isChecking: boolean;
  isAgentExpired: boolean;
  needsAgentApproval: boolean;
  needsBuilderApproval: boolean;
  needsUnifiedEnable: boolean;
  pendingSteps: TradingSetupStep[];
  blockingSteps: TradingSetupStep[];
  stepStates: Record<TradingSetupStep, ApprovalRequirementState>;
  shouldPromptRestoreUnified: boolean;
  lastVerifiedAt: number | null;
}

export interface Order {
  coin: string;
  side: OrderSide;
  sizeUsd: number;
  limitPx?: number;
  orderType: OrderType;
  reduceOnly: boolean;
  leverage?: number;
  marketType?: MarketType;
  tif?: "Gtc" | "Alo" | "Ioc" | null;
  cloid?: string;
}

export interface TriggerOrderRequest {
  coin: string;
  side: OrderSide;
  size: number;
  triggerPx: number;
  triggerKind: TriggerOrderKind;
  reduceOnly: true;
  marketType: "perp";
  cloid?: string;
}

export interface PositionProtectionRequest {
  coin: string;
  stopLossPx?: number | null;
  takeProfitPx?: number | null;
  /** Signed expected position size (positive=long, negative=short). When provided,
   *  skips polling getUserState waiting for the fill to appear — use after placing
   *  a fresh market order when the approximate size is already known. */
  sizeHint?: number | null;
  /** Skip cancelling existing SL/TP orders before placing new ones. Safe to set
   *  when this is a brand-new position with no prior protection orders. */
  skipCancelExisting?: boolean;
}

export interface StableSwapRequest {
  fromAsset: StableSwapAsset;
  toAsset: StableSwapAsset;
  amount: number;
}

export interface StableSwapResult {
  fromAsset: StableSwapAsset;
  toAsset: StableSwapAsset;
  amount: number;
  message: string;
  sweepBackAmount?: number;
  dustRemaining?: number;
}

export interface OrderValidationResult {
  isValid: boolean;
  minSizeUsd: number;
  minMarginUsd: number;
  reason?: string;
}

export interface PlacedOrder {
  oid: number;
  coin: string;
  side: OrderSide;
  limitPx: number;
  sz: number;
  timestamp: number;
  orderType: OrderType;
  reduceOnly: boolean;
  postOnly: boolean;
}

export interface OpenOrder {
  oid: number;
  coin: string;
  side: OrderSide;
  limitPx: number;
  sz: number;
  timestamp: number;
  orderType: OrderType;
  reduceOnly: boolean;
  tif?: string | null;
  triggerPx?: number | null;
  isTrigger?: boolean;
  isPositionTpsl?: boolean;
  cloid?: string | null;
}

// Position types
export interface Position {
  coin: string;
  szi: number;
  leverage: {
    type: "isolated" | "cross";
    value: number;
  };
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  marginUsed: number;
  maxLeverage: number;
}

// Account types
export interface AccountState {
  abstractionMode: AccountAbstractionMode;
  hip3DexAbstractionEnabled: boolean | null;
  stableBalances: Partial<Record<StableSwapAsset, StableBalanceState>>;
  visibleStableBalances?: VisibleStableBalance[];
  shouldPromptRestoreUnified?: boolean;
  availableBalance: number;
  withdrawableBalance: number;
  marginSummary: {
    accountValue: number;
    totalMarginUsed: number;
    totalNtlPos: number;
    totalRawUsd: number;
  };
  crossMarginSummary: {
    accountValue: number;
    totalMarginUsed: number;
    totalNtlPos: number;
    totalRawUsd: number;
  };
  crossMaintenanceMarginUsed: number;
  withdrawable: number;
  assetPositions: Array<{
    position: Position;
    type: "oneWay";
  }>;
}

// Orderbook types
export interface OrderbookLevel {
  px: number;
  sz: number;
  n: number;
}

export interface Orderbook {
  coin: string;
  levels: {
    bids: OrderbookLevel[];
    asks: OrderbookLevel[];
  };
  time: number;
}

// Candle types
export interface Candle {
  t: number; // open time
  T: number; // close time
  s: string; // coin
  i: string; // interval
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  n: number; // number of trades
}

// Fill types
export interface Fill {
  coin: string;
  px: number;
  sz: number;
  side: OrderSide;
  time: number;
  startPosition: number;
  dir: "Open" | "Close" | "Flip";
  closedPnl: number;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: number;
  tid: number;
  cloid?: string | null;
  feeToken?: string;
}

// Builder code types
export interface BuilderCode {
  b: string; // builder address
  f: number; // fee in tenths of basis points
}

// WebSocket message types
export type WsMessage =
  | { channel: "allMids"; data: Record<string, string> }
  | {
      channel: "l2Book";
      data: {
        coin: string;
        levels: [OrderbookLevel[], OrderbookLevel[]];
        time: number;
      };
    }
  | {
      channel: "trades";
      data: Array<{
        coin: string;
        side: OrderSide;
        px: number;
        sz: number;
        time: number;
        hash: string;
      }>;
    }
  | { channel: "candle"; data: Candle }
  | {
      channel: "orderUpdates";
      data: Array<{
        order: PlacedOrder;
        status: "open" | "filled" | "canceled" | "rejected" | "marginCanceled";
      }>;
    }
  | { channel: "userFills"; data: Fill[] }
  | {
      channel: "userFundings";
      data: Array<{
        coin: string;
        fundingRate: number;
        premium: number;
        time: number;
      }>;
    }
  | { channel: "userNonFundingLedgerUpdates"; data: unknown[] };

// Market stats types (derived from metaAndAssetCtxs response)
export interface MarketStats {
  coin: string;
  markPx: number;
  prevDayPx: number;
  dayNtlVlm: number;
  openInterest: number;
  funding: number;
  oraclePx: number;
  change24h: number; // computed: (markPx - prevDayPx) / prevDayPx * 100
}

export interface AssetCtx extends MarketStats {}

export type PortfolioRange = "1d" | "7d" | "30d";

export interface PortfolioHistoryPoint {
  time: number; // unix ms
  value: number; // series value in USD
}

export interface PortfolioPeriodData {
  period: PortfolioRange;
  accountValueHistory: PortfolioHistoryPoint[];
  pnlHistory: PortfolioHistoryPoint[];
  volume: number;
}

// Telegram types
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramInitData {
  query_id?: string;
  user?: TelegramUser;
  receiver?: TelegramUser;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash: string;
}

export type QuestId =
  | "first_deposit"
  | "first_trade"
  | "referral_funded_friend"
  | "second_deposit_7d";

export const APP_TRADE_CLOID_PREFIX = "0x1a17";

export type QuestStatus = "locked" | "in_progress" | "completed";

export type RewardKind = "usdc" | "xp" | "tickets" | "raffle";

/**
 * `held` is the XP-only mode's terminal parking state for cash entitlements.
 *
 * Every `usdc`/`raffle` row that was still `pending` or `failed` when the
 * program went XP-only was moved to `held`: it is neither owed nor paid, it is
 * frozen pending reconciliation, and no ingestion path may move it out again.
 * `posted` history is never rewritten, so a genuinely paid row stays paid.
 */
export type RewardLedgerStatus = "pending" | "posted" | "failed" | "held";

export interface QuestReward {
  kind: RewardKind;
  amount: number;
  label: string;
}

export interface QuestProgress {
  id: QuestId;
  title: string;
  description: string;
  status: QuestStatus;
  completedAt: string | null;
  progressCurrent: number;
  progressTarget: number;
  rewards: QuestReward[];
}

export interface RewardLedgerEntry {
  id: string;
  userId: string;
  seasonId: string | null;
  weekStart: string | null;
  questId: QuestId | null;
  rewardKind: RewardKind;
  amount: number;
  asset: string | null;
  status: RewardLedgerStatus;
  idempotencyKey: string;
  source: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  postedAt: string | null;
}

export interface VolumeXpGrant {
  fillKey: string;
  userId: string;
  seasonId: string | null;
  weekStart: string | null;
  volumeUsd: number;
  xp: number;
  occurredAt: string;
  rewardKind: "xp";
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  rank: number;
  eligibleVolume: number;
  xp: number;
  raffleEligible: boolean;
}

/**
 * The shape the weekly raffle exposes while payouts are disabled.
 *
 * The server does not compute eligibility, ranks or winners in this mode, so
 * there is deliberately nothing here to render. `weeklyRaffle` is typed as
 * this alone rather than as a union with WeeklyRaffleSnapshot: a union would
 * let the client keep its eligibility UI behind a branch that never runs, and
 * the point is for the compiler to prove that UI is gone.
 */
export interface WeeklyRafflePaused {
  state: "paused";
}

/**
 * How fresh the numbers on the dashboard are.
 *
 * `syncing` means ingestion has not completed a first pass for this account —
 * the totals are real but incomplete, and a user who just traded should be told
 * that rather than shown a confident zero. `stale` means it succeeded once but
 * not recently; `error` means recent attempts are failing. Deliberately
 * carries no message: the reason belongs in logs, not on a user's screen.
 */
export type RewardsSyncState = "synced" | "syncing" | "stale" | "error";

export interface RewardsSyncStatus {
  state: RewardsSyncState;
  /** Last time fills were ingested successfully, or null before a first pass. */
  lastSyncedAt: string | null;
  /**
   * The exchange can no longer prove this account's history is complete —
   * denser than its per-response cap, or longer than its retention ceiling.
   */
  retentionRisk: boolean;
}

/**
 * What the client is allowed to offer, as told by the server.
 *
 * The client renders capabilities from this descriptor instead of inferring
 * them from missing data or from its own build-time environment, so a stale
 * bundle cannot advertise a payout the server will refuse.
 */
export interface RewardsProgramStatus {
  mode: "xp_only";
  usdcPayoutsEnabled: false;
  weeklyRaffleEnabled: false;
}

/**
 * Dormant until a separately reviewed raffle relaunch.
 *
 * Kept — like `api/rewards/_lib/payout.ts` and `_lib/raffle.ts` — so the
 * historical shape stays readable for reconciliation. Nothing in the live
 * dashboard response references it.
 */
export interface WeeklyRaffleWinner {
  userId: string;
  displayName: string;
  prizeUsdc: number;
}

export interface WeeklyRaffleSnapshot {
  weekStart: string;
  weekEnd: string;
  cohortSize: number;
  winnerCount: number;
  cutoffVolume: number;
  userRank: number | null;
  userEligibleVolume: number;
  userDistanceToCutoff: number;
  userIsEligible: boolean;
  winners: WeeklyRaffleWinner[];
}

export interface SeasonSnapshot {
  seasonId: string | null;
  name: string;
  startsAt: string;
  endsAt: string;
  xpTotal: number;
  questXpTotal: number;
  volumeXpTotal: number;
  eligibleVolume: number;
  leaderboardRank: number | null;
}

export interface ReferralSummary {
  referralCode: string;
  referredCount: number;
  fundedReferralCount: number;
  hasReferrer: boolean;
}

export interface RewardsDashboard {
  season: SeasonSnapshot;
  quests: QuestProgress[];
  referral: ReferralSummary;
  leaderboard: {
    entries: LeaderboardEntry[];
    userRank: number | null;
    userDistanceToCutoff: number;
  };
  weeklyRaffle: WeeklyRafflePaused;
  /** XP entries only. Held and paid cash history lives in the admin surface. */
  rewardHistory: RewardLedgerEntry[];
  programStatus: RewardsProgramStatus;
  sync: RewardsSyncStatus;
}
