import type {
  AccountAbstractionMode,
  StableBalanceState,
  StableSwapAsset,
  TradingSetupStatus,
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

function inferCollateralAsset(marketName: string): StableSwapAsset {
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
  const collateralAsset = inferCollateralAsset(marketName);

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

  return fallbackWithdrawable;
}

export function evaluateTradingSetupStatus({
  hasAgentKey,
  isAgentExpired,
  abstractionMode,
  prefersUnifiedAccount,
  needsBuilderApproval,
  targetIsHip3,
  hip3DexAbstractionEnabled,
}: {
  hasAgentKey: boolean;
  isAgentExpired: boolean;
  abstractionMode: AccountAbstractionMode;
  prefersUnifiedAccount: boolean;
  needsBuilderApproval: boolean;
  targetIsHip3: boolean;
  hip3DexAbstractionEnabled: boolean | null;
}): TradingSetupStatus {
  const needsAgentApproval = !hasAgentKey || isAgentExpired;
  const shouldPromptRestoreUnified =
    prefersUnifiedAccount && abstractionMode === "standard";
  const needsUnifiedEnable = abstractionMode === "standard";
  const needsHip3AbstractionEnable =
    targetIsHip3 && !hip3DexAbstractionEnabled;
  const pendingSteps = [
    needsAgentApproval ? "agent" : null,
    needsBuilderApproval ? "builder" : null,
    needsUnifiedEnable ? "unified" : null,
    needsHip3AbstractionEnable ? "hip3" : null,
  ].filter((step): step is "agent" | "builder" | "unified" | "hip3" => step != null);

  return {
    canTrade:
      !needsAgentApproval &&
      !needsBuilderApproval &&
      !needsUnifiedEnable &&
      !needsHip3AbstractionEnable,
    isAgentExpired,
    needsAgentApproval,
    needsBuilderApproval,
    needsHip3AbstractionEnable,
    needsUnifiedEnable,
    pendingSteps,
    shouldPromptRestoreUnified,
  };
}

export function getSupportedStableAssets(): StableSwapAsset[] {
  return [...SUPPORTED_STABLE_ASSETS];
}
