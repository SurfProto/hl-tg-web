import type {
  AccountState,
  AccountAbstractionMode,
  ApprovalRequirementState,
  StableBalanceState,
  StableSwapAsset,
  TradingSetupStatus,
  TradingSetupStep,
  VisibleStableBalance,
} from "@repo/types";

const SUPPORTED_STABLE_ASSETS: StableSwapAsset[] = [
  "USDC",
  "USDH",
  "USDT",
  "USDE",
];

function parseBalanceAmount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : 0;
}

export function getMarketCollateralAsset(marketName: string): StableSwapAsset {
  const match = marketName.toUpperCase().match(/-(USDC|USDH|USDT|USDE)\b/);
  const asset = match?.[1] as StableSwapAsset | undefined;
  return asset ?? "USDC";
}

export function inferAbstractionMode(
  abstraction: string | null | undefined,
  hip3DexAbstractionEnabled: boolean | null | undefined,
): AccountAbstractionMode {
  if (abstraction === "unifiedAccount") return "unifiedAccount";
  if (abstraction === "portfolioMargin") return "portfolioMargin";
  if (abstraction === "dexAbstraction" || hip3DexAbstractionEnabled) {
    return "dexAbstraction";
  }
  if (
    abstraction === "default" ||
    abstraction === "disabled" ||
    abstraction == null
  ) {
    return "standard";
  }
  return "unknown";
}

export function normalizeStableBalances(
  balances: Array<{ coin?: string; total?: unknown; hold?: unknown }> | null | undefined,
): Partial<Record<StableSwapAsset, StableBalanceState>> {
  const result: Partial<Record<StableSwapAsset, StableBalanceState>> = {};

  for (const balance of balances ?? []) {
    const asset = balance.coin?.toUpperCase() as StableSwapAsset | undefined;
    if (!asset || !SUPPORTED_STABLE_ASSETS.includes(asset)) continue;

    const total = parseBalanceAmount(balance.total);
    const hold = parseBalanceAmount(balance.hold);
    result[asset] = {
      total,
      hold,
      available: Math.max(0, total - hold),
    };
  }

  return result;
}

export function normalizePerpStableBalance({
  totalRawUsd,
  totalMarginUsed,
}: {
  totalRawUsd?: unknown;
  totalMarginUsed?: unknown;
}): StableBalanceState {
  const total = Math.max(0, parseBalanceAmount(totalRawUsd));
  const marginUsed = Math.max(0, parseBalanceAmount(totalMarginUsed));
  const available = Math.max(0, total - marginUsed);
  const hold = Math.min(total, marginUsed);

  return {
    total,
    hold,
    available,
    perp: {
      total,
      hold,
      available,
    },
  };
}

export function getVisibleStableBalances(
  stableBalances: Partial<Record<StableSwapAsset, StableBalanceState>>,
): VisibleStableBalance[] {
  return SUPPORTED_STABLE_ASSETS.flatMap((asset) => {
    const balance = stableBalances[asset];
    if (!balance) return [];
    if (balance.total <= 0 && balance.hold <= 0) return [];
    return [{ asset, ...balance }];
  });
}

export function getActionableBalances(
  stableBalances: Partial<Record<StableSwapAsset, StableBalanceState>>,
  fallbackBalance: number = 0,
): {
  availableBalance: number;
  withdrawableBalance: number;
} {
  const availableBalance = SUPPORTED_STABLE_ASSETS.reduce(
    (sum, asset) => sum + (stableBalances[asset]?.available ?? 0),
    0,
  );
  const hasVisibleStableBalances =
    getVisibleStableBalances(stableBalances).length > 0;

  if (hasVisibleStableBalances) {
    return {
      availableBalance,
      withdrawableBalance: availableBalance,
    };
  }

  const actionableFallback = Math.max(0, fallbackBalance);
  return {
    availableBalance: actionableFallback,
    withdrawableBalance: actionableFallback,
  };
}

export function getNormalizedTotalEquity({
  availableBalance,
  assetPositions,
}: {
  availableBalance: number;
  assetPositions: Array<{
    position?: {
      marginUsed?: number;
      unrealizedPnl?: number;
    };
  }>;
}): number {
  const idleBalance = Number.isFinite(availableBalance) ? availableBalance : 0;

  // Collateral behind open positions, plus what those positions are currently
  // worth. NOT positionValue, which is notional -- size times mark -- and is
  // leveraged exposure rather than money the account holds. Adding it read an
  // account with $28.17 free and $8.06 of margin behind a 10x position as
  // holding $126.23, because $98.16 of borrowed exposure was counted as
  // equity. The true figure was $36.23.
  //
  // This is the standard identity: equity = free collateral + margin used +
  // unrealised PnL. Available already nets margin out of the raw balance, so
  // adding both back gives the total the account would hold if every position
  // closed at mark.
  const marginAndPnl = assetPositions.reduce((sum, assetPosition) => {
    const marginUsed = assetPosition.position?.marginUsed ?? 0;
    const unrealizedPnl = assetPosition.position?.unrealizedPnl ?? 0;
    return (
      sum +
      (Number.isFinite(marginUsed) ? marginUsed : 0) +
      (Number.isFinite(unrealizedPnl) ? unrealizedPnl : 0)
    );
  }, 0);

  return idleBalance + marginAndPnl;
}

export function getUnifiedApprovalState(
  accountState: Pick<AccountState, "abstractionMode"> | undefined,
  fallback: { enabled: boolean; abstractionMode: AccountAbstractionMode } | undefined,
): { enabled: boolean; abstractionMode: AccountAbstractionMode } | undefined {
  if (!accountState) {
    return fallback;
  }

  return {
    enabled:
      accountState.abstractionMode === "unifiedAccount" ||
      accountState.abstractionMode === "portfolioMargin",
    abstractionMode: accountState.abstractionMode,
  };
}

function mergeStableBalanceStates(
  left: StableBalanceState | undefined,
  right: StableBalanceState | undefined,
): StableBalanceState | undefined {
  if (!left && !right) return undefined;

  const total = (left?.total ?? 0) + (right?.total ?? 0);
  const hold = (left?.hold ?? 0) + (right?.hold ?? 0);
  const available = (left?.available ?? 0) + (right?.available ?? 0);

  return {
    total,
    hold,
    available,
    ...(left ? { spot: left.spot ?? left } : {}),
    ...(right ? { perp: right.perp ?? right } : {}),
  };
}

export function combineStableBalances({
  abstractionMode,
  spotBalances,
  perpBalances,
}: {
  abstractionMode: AccountAbstractionMode;
  spotBalances: Partial<Record<StableSwapAsset, StableBalanceState>>;
  perpBalances: Partial<Record<StableSwapAsset, StableBalanceState>>;
}): Partial<Record<StableSwapAsset, StableBalanceState>> {
  if (
    abstractionMode === "unifiedAccount" ||
    abstractionMode === "portfolioMargin"
  ) {
    return Object.fromEntries(
      Object.entries(spotBalances).map(([asset, balance]) => [
        asset,
        {
          ...balance,
          spot: balance,
        },
      ]),
    ) as Partial<Record<StableSwapAsset, StableBalanceState>>;
  }

  return SUPPORTED_STABLE_ASSETS.reduce<
    Partial<Record<StableSwapAsset, StableBalanceState>>
  >((result, asset) => {
    const merged = mergeStableBalanceStates(
      spotBalances[asset],
      perpBalances[asset],
    );
    if (merged) {
      result[asset] = merged;
    }
    return result;
  }, {});
}

export function getAvailableCollateralForMarket({
  abstractionMode,
  stableBalances,
  fallbackWithdrawable,
  marketName,
}: {
  abstractionMode: AccountAbstractionMode;
  stableBalances: Partial<Record<StableSwapAsset, StableBalanceState>>;
  fallbackWithdrawable: number;
  marketName: string;
}): number {
  const collateralAsset = getMarketCollateralAsset(marketName);

  if (abstractionMode === "dexAbstraction") {
    if (collateralAsset === "USDC") {
      return fallbackWithdrawable;
    }
    return stableBalances[collateralAsset]?.available ?? 0;
  }

  if (
    abstractionMode === "unifiedAccount" ||
    abstractionMode === "portfolioMargin"
  ) {
    return stableBalances[collateralAsset]?.available ?? 0;
  }

  if (collateralAsset === "USDC") {
    return fallbackWithdrawable;
  }

  return stableBalances[collateralAsset]?.available ?? 0;
}

export function evaluateTradingSetupStatus({
  agentState,
  isAgentExpired,
  abstractionMode,
  prefersUnifiedAccount,
  builderState,
  unifiedState,
}: {
  agentState: ApprovalRequirementState;
  isAgentExpired: boolean;
  abstractionMode: AccountAbstractionMode;
  prefersUnifiedAccount: boolean;
  builderState: ApprovalRequirementState;
  unifiedState: ApprovalRequirementState;
}): TradingSetupStatus {
  const needsAgentApproval = agentState === "missing";
  const shouldPromptRestoreUnified =
    prefersUnifiedAccount && abstractionMode === "standard";
  const needsBuilderApproval = builderState === "missing";
  const needsUnifiedEnable = unifiedState === "missing";
  const blockingSteps = [
    needsAgentApproval ? "agent" : null,
    needsBuilderApproval ? "builder" : null,
    needsUnifiedEnable ? "unified" : null,
  ].filter((step): step is TradingSetupStep => step != null);
  const isChecking =
    agentState === "checking" ||
    builderState === "checking" ||
    unifiedState === "checking";

  return {
    canTrade: blockingSteps.length === 0 && !isChecking,
    isChecking,
    isAgentExpired,
    needsAgentApproval,
    needsBuilderApproval,
    needsUnifiedEnable,
    pendingSteps: blockingSteps,
    blockingSteps,
    stepStates: {
      agent: agentState,
      builder: builderState,
      unified: unifiedState,
    },
    shouldPromptRestoreUnified,
    lastVerifiedAt: isChecking ? null : Date.now(),
  };
}

export function getSupportedStableAssets(): StableSwapAsset[] {
  return [...SUPPORTED_STABLE_ASSETS];
}

/**
 * Hyperliquid sends every number as a string, so the shapes below are what the
 * `clearinghouseState` and `spotClearinghouseState` info endpoints actually
 * return, not what they mean. `buildAccountState` turns them into numbers.
 */
export interface RawMarginSummary {
  accountValue?: unknown;
  totalMarginUsed?: unknown;
  totalNtlPos?: unknown;
  totalRawUsd?: unknown;
}

export interface RawAssetPosition {
  type?: unknown;
  position: {
    coin: string;
    szi?: unknown;
    leverage: { type?: unknown; value?: unknown };
    entryPx?: unknown;
    liquidationPx?: unknown;
    marginUsed?: unknown;
    maxLeverage?: unknown;
    positionValue?: unknown;
    returnOnEquity?: unknown;
    unrealizedPnl?: unknown;
  };
}

export interface RawClearinghouseState {
  marginSummary?: RawMarginSummary | null;
  crossMarginSummary?: RawMarginSummary | null;
  crossMaintenanceMarginUsed?: unknown;
  withdrawable?: unknown;
  assetPositions?: RawAssetPosition[] | null;
}

export interface RawSpotClearinghouseState {
  balances?: Array<{ coin?: string; total?: unknown; hold?: unknown }> | null;
}

/**
 * `parseFloat` on values the API is expected to send as strings. Deliberately
 * NaN-propagating rather than zero-filling: a malformed number reaching a
 * balance should be visible, not quietly read as no money.
 */
function toFloat(value: unknown): number {
  return Number.parseFloat(value as string);
}

/**
 * Add one more balance of the same asset onto a running total, keeping the
 * spot and perp breakdowns separate.
 *
 * Not the same operation as `mergeStableBalanceStates`, which pairs a spot
 * balance with a perp one. This sums like with like — several HIP-3 dexes can
 * share a collateral asset, and each contributes its own perp balance.
 */
function accumulateStableBalance(
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
              (current?.spot?.available ?? 0) + (next.spot?.available ?? 0),
          },
        }
      : {}),
    ...(current?.perp || next.perp
      ? {
          perp: {
            total: (current?.perp?.total ?? 0) + (next.perp?.total ?? 0),
            hold: (current?.perp?.hold ?? 0) + (next.perp?.hold ?? 0),
            available:
              (current?.perp?.available ?? 0) + (next.perp?.available ?? 0),
          },
        }
      : {}),
  };
}

function parseMarginSummary(marginSummary: RawMarginSummary | null | undefined) {
  return {
    accountValue: toFloat(marginSummary?.accountValue ?? "0"),
    totalMarginUsed: toFloat(marginSummary?.totalMarginUsed ?? "0"),
    totalNtlPos: toFloat(marginSummary?.totalNtlPos ?? "0"),
    totalRawUsd: toFloat(marginSummary?.totalRawUsd ?? "0"),
  };
}

/**
 * Fold the clearinghouse responses for the base perp account, the spot account
 * and every HIP-3 dex into one `AccountState`.
 *
 * `dexStates` is positional: entry `i` is the state for `perpDexs[i]`. That
 * alignment is the caller's `Promise.all` order and is what attributes a
 * balance to the right collateral asset, so it is pinned by tests.
 */
export function buildAccountState({
  baseState,
  spotState,
  abstraction,
  hip3DexAbstractionEnabled,
  perpDexs,
  dexStates,
}: {
  baseState: RawClearinghouseState | null | undefined;
  spotState: RawSpotClearinghouseState | null | undefined;
  abstraction: string | null | undefined;
  hip3DexAbstractionEnabled: boolean | null | undefined;
  perpDexs: Array<{ dex: string; collateralAsset?: StableSwapAsset }>;
  dexStates: Array<RawClearinghouseState | null | undefined>;
}): AccountState {
  const allStates: Array<{
    dex: string | undefined;
    state: RawClearinghouseState | null | undefined;
  }> = [
    { dex: undefined, state: baseState },
    ...dexStates.map((state, index) => ({
      dex: perpDexs[index]?.dex,
      state,
    })),
  ];

  const abstractionMode = inferAbstractionMode(
    abstraction,
    hip3DexAbstractionEnabled,
  );
  const spotStableBalances = normalizeStableBalances(spotState?.balances);
  const perpStableBalances = allStates.reduce<
    Partial<Record<StableSwapAsset, StableBalanceState>>
  >((result, { dex, state }) => {
    const collateralAsset = dex
      ? perpDexs.find((entry) => entry.dex === dex)?.collateralAsset
      : "USDC";
    if (!collateralAsset) return result;

    const normalized = normalizePerpStableBalance({
      totalRawUsd: state?.marginSummary?.totalRawUsd,
      totalMarginUsed: state?.marginSummary?.totalMarginUsed,
    });

    result[collateralAsset] = accumulateStableBalance(
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
  const crossMarginSummary = parseMarginSummary(baseState?.crossMarginSummary);
  const rawWithdrawable = toFloat(baseState?.withdrawable ?? "0");
  const { availableBalance, withdrawableBalance } = getActionableBalances(
    stableBalances,
    visibleStableBalances.length === 0 ? rawWithdrawable : 0,
  );
  const assetPositions = allStates.flatMap(({ dex, state }) =>
    (state?.assetPositions ?? []).map((assetPosition) => ({
      type: assetPosition.type as "oneWay",
      position: {
        // A HIP-3 dex reports its own bare symbol, so qualify it the way the
        // rest of the app names those markets.
        coin:
          dex && !assetPosition.position.coin.includes(":")
            ? `${dex}:${assetPosition.position.coin}`
            : assetPosition.position.coin,
        szi: toFloat(assetPosition.position.szi),
        leverage: {
          type: assetPosition.position.leverage.type as "isolated" | "cross",
          value: toFloat(assetPosition.position.leverage.value),
        },
        entryPx: toFloat(assetPosition.position.entryPx),
        liquidationPx:
          assetPosition.position.liquidationPx != null
            ? toFloat(assetPosition.position.liquidationPx)
            : null,
        marginUsed: toFloat(assetPosition.position.marginUsed),
        maxLeverage: toFloat(assetPosition.position.maxLeverage),
        positionValue: toFloat(assetPosition.position.positionValue),
        returnOnEquity: toFloat(assetPosition.position.returnOnEquity),
        unrealizedPnl: toFloat(assetPosition.position.unrealizedPnl),
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

  return {
    abstractionMode,
    hip3DexAbstractionEnabled: hip3DexAbstractionEnabled ?? null,
    stableBalances,
    visibleStableBalances,
    availableBalance,
    withdrawableBalance,
    marginSummary,
    crossMarginSummary,
    crossMaintenanceMarginUsed: toFloat(
      baseState?.crossMaintenanceMarginUsed ?? "0",
    ),
    withdrawable: rawWithdrawable,
    assetPositions,
  };
}
