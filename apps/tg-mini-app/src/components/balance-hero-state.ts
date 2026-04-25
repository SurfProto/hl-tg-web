import type { AccountState } from "@repo/types";

export interface BalanceHeroValueState {
  state: "loading" | "error" | "ready";
  totalValue: number | null;
  availableValue: number | null;
}

export function getBalanceHeroValueState({
  userState,
  isLoading,
  isError,
}: {
  userState: AccountState | undefined;
  isLoading: boolean;
  isError: boolean;
}): BalanceHeroValueState {
  if (isLoading) {
    return {
      state: "loading",
      totalValue: null,
      availableValue: null,
    };
  }

  if (isError) {
    return {
      state: "error",
      totalValue: null,
      availableValue: null,
    };
  }

  return {
    state: "ready",
    totalValue: userState?.marginSummary?.accountValue ?? 0,
    availableValue: userState?.availableBalance ?? 0,
  };
}

export function getBalanceHeroDisplayState(valueState: BalanceHeroValueState) {
  return {
    highlightValue: valueState.totalValue ?? 0,
    availableValue: valueState.availableValue ?? 0,
  };
}
