// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PositionsPage } from "./PositionsPage";

/**
 * The lie this file exists to prevent.
 *
 * PositionsPage used to destructure only `data` from its account hooks, so an
 * unanswered snapshot was indistinguishable from a settled empty account and
 * the page rendered "No open positions · Start trading" over a live leveraged
 * trade. React Query keeps the last good value through a failed refetch, so
 * only a COLD open reaches this — which in a Telegram mini app is every
 * launch, and during a database outage is every launch that matters.
 */

const hookState = {
  userState: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  openOrders: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
};

vi.mock("@repo/hyperliquid-sdk", () => ({
  useUserState: () => hookState.userState,
  useOpenOrders: () => hookState.openOrders,
  useFills: () => ({ data: [] }),
  useHistoricalOrders: () => ({ data: [] }),
  useUserFunding: () => ({ data: [] }),
  useMarketPrice: () => ({ data: undefined, isLoading: false, isError: false }),
  useCancelAllOrders: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useModifyOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useClosePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertPositionProtection: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// The page renders outside the app shell here, so the two context-backed
// hooks it reaches for need stand-ins. Neither participates in what these
// tests assert.
vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("../hooks/useHaptics", () => ({
  useHaptics: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    impact: vi.fn(),
    selection: vi.fn(),
  }),
}));

function setAccount(
  partial: Partial<(typeof hookState)["userState"]>,
  orders: Partial<(typeof hookState)["openOrders"]> = {},
) {
  hookState.userState = { ...hookState.userState, ...partial };
  hookState.openOrders = { ...hookState.openOrders, ...orders };
}

describe("PositionsPage account states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.userState = {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    hookState.openOrders = {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it("does not claim an empty account while the snapshot is loading", () => {
    setAccount({ data: undefined, isLoading: true }, { isLoading: true });

    render(<PositionsPage />);

    expect(screen.queryByText("positions.emptyTitle")).toBeNull();
    expect(screen.queryByText("positions.startTrading")).toBeNull();
  });

  it("says positions are unavailable, not absent, when the snapshot fails", () => {
    setAccount({ data: undefined, isError: true });

    render(<PositionsPage />);

    expect(screen.getByText("positions.loadFailed")).toBeVisible();
    expect(screen.queryByText("positions.emptyTitle")).toBeNull();
  });

  it("offers a retry that refetches the snapshot", async () => {
    const refetch = vi.fn();
    setAccount({ data: undefined, isError: true, refetch });

    render(<PositionsPage />);
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));

    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state only once the snapshot has answered", () => {
    setAccount({ data: { assetPositions: [] }, isLoading: false, isError: false });

    render(<PositionsPage />);

    expect(screen.getByText("positions.emptyTitle")).toBeVisible();
  });

  it("does not claim an empty order book while orders are unavailable", () => {
    // Account answered; the orders query is the one that failed.
    setAccount(
      { data: { assetPositions: [] } },
      { data: undefined, isError: true },
    );

    render(<PositionsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /positions.tabOrders/ }));

    expect(screen.queryByText("positions.ordersLoadFailed")).not.toBeNull();
  });
});
