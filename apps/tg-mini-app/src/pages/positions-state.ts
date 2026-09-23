import { getAsyncValueState } from "../lib/async-value-state";

export type PositionsListViewState = "loading" | "error" | "empty" | "ready";

/**
 * What one of the live Positions tabs is allowed to claim.
 *
 * "No open positions — Start trading" is a statement about the account, and
 * this page used to make it straight from `data ?? []`. So a first paint, an
 * evicted webview, or a 503 from /api/account/snapshot during a database
 * outage all rendered it while the position was open and the resting orders
 * were live. React Query keeps the last good list through a failed refetch,
 * so a session already on screen never blanked — it is the cold open that
 * lied, and in a Telegram mini app the cold open is every launch.
 *
 * The three-way part of the decision stays `getAsyncValueState`'s, so these
 * lists and the mark price this screen already reads through it cannot drift
 * apart: a value we hold beats a failing refetch (the rule the balance hero
 * learned in b62ed3cb), and "nothing known yet" reads as loading rather than
 * as an answer. That last branch is load-bearing rather than incidental —
 * every account query is `enabled: Boolean(scope)`, a disabled query reports
 * neither loading nor error, and that is exactly the window where Privy is
 * still resolving the Telegram user on a cold launch.
 *
 * Only the empty/ready split is added on top, because emptiness is a fact
 * about a list the server actually returned.
 */
export function getPositionsListViewState({
  hasValue,
  isLoading,
  isError,
  count,
}: {
  hasValue: boolean;
  isLoading: boolean;
  isError: boolean;
  count: number;
}): PositionsListViewState {
  const valueState = getAsyncValueState({ hasValue, isLoading, isError });

  if (valueState !== "ready") {
    return valueState;
  }

  return count === 0 ? "empty" : "ready";
}

/**
 * The count to show beside a tab label, or null when there is nothing honest
 * to show.
 *
 * The tab bar rendered `positions.length` unconditionally, so the same lie the
 * list was fixed for survived in the chrome: `Open · 0` beside a live position
 * while the snapshot was still in flight. A tab with no number reads as "not
 * known yet", which is the truth.
 */
export function getPositionsTabCount(
  state: PositionsListViewState,
  count: number,
): number | null {
  return state === "loading" || state === "error" ? null : count;
}
