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
  const needsUnifiedEnable =
    abstractionMode === "standard" && !prefersUnifiedAccount;
  const needsHip3AbstractionEnable =
    targetIsHip3 && !hip3DexAbstractionEnabled;

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
    shouldPromptRestoreUnified,
  };
}

export function getSupportedStableAssets(): StableSwapAsset[] {
  return [...SUPPORTED_STABLE_ASSETS];
}
