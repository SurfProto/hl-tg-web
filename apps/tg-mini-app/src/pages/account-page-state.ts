import type { AccountState } from "@repo/types";

export function getAccountOverviewStats(userState: AccountState | undefined) {
  return {
    totalEquity: userState?.marginSummary?.accountValue ?? 0,
    marginLocked: userState?.marginSummary?.totalMarginUsed ?? 0,
    availableBalance: userState?.availableBalance ?? 0,
    withdrawableBalance: userState?.withdrawableBalance ?? 0,
  };
}
