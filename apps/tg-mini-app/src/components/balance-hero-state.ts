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
  // Last-known balance wins over a transient error. The snapshot refetches
  // every 5s, and React Query keeps the last good `userState` while a refetch
  // is failing — so a single failed poll (an upstream blip, a rate-limit tick)
  // must not blank a balance we already have. Only when there is genuinely
  // nothing to show does loading or error surface. This was the recurring
  // "my balance disappeared" — one bad poll flipped the whole hero to
  // "balance unavailable" and back.
  if (userState) {
    return {
      state: "ready",
      totalValue: userState.marginSummary?.accountValue ?? 0,
      availableValue: userState.availableBalance ?? 0,
    };
  }

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

  // No data, not loading, not errored: the signed-out / no-scope state, where
  // zero is the honest figure until an account is attached.
  return {
    state: "ready",
    totalValue: 0,
    availableValue: 0,
  };
}

export function getBalanceHeroDisplayState(valueState: BalanceHeroValueState) {
  return {
    highlightValue: valueState.totalValue ?? 0,
    availableValue: valueState.availableValue ?? 0,
  };
}
