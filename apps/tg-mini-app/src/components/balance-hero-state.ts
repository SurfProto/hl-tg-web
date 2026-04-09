import type { AccountState } from "@repo/types";

export function getBalanceHeroValueState({
  userState,
  isLoading,
  isError,
}: {
  userState: AccountState | undefined;
  isLoading: boolean;
  isError: boolean;
}): {
  state: "loading" | "error" | "ready";
  totalValue: number | null;
  availableValue: number | null;
} {
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
