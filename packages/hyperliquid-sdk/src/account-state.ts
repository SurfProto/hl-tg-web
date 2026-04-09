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
      positionValue?: number;
    };
  }>;
}): number {
  const idleBalance = Number.isFinite(availableBalance) ? availableBalance : 0;
  const openPositionValue = assetPositions.reduce((sum, assetPosition) => {
    const positionValue = assetPosition.position?.positionValue ?? 0;
    return sum + (Number.isFinite(positionValue) ? positionValue : 0);
  }, 0);

  return idleBalance + openPositionValue;
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
