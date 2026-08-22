// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

// HOME_MARKET_LIMIT in HomePage.tsx. Kept as a literal so a change to the cap
// has to be made deliberately in both places.
const HOME_MARKET_LIMIT = 20;

let perpMarkets: Array<{ name: string; maxLeverage: number }> = [];

function makeMarkets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `C${String(index).padStart(3, "0")}`,
    maxLeverage: 10,
  }));
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const table: Record<string, string> = {
        "nav.markets": "Markets",
        "home.ariaSearch": "Search markets",
        "home.seeAll": "See all",
        "home.seeAllMarkets": "See all {{count}} markets",
        "home.noMarkets": "No markets",
      };
      const value = table[key] ?? key;
      return options
        ? value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name]))
        : value;
    },
  }),
}));

vi.mock("@repo/hyperliquid-sdk", () => ({
  CATEGORY_LABELS: { all: "All", crypto: "Crypto" },
  CATEGORY_ORDER: ["all", "crypto"],
  SUB_FILTERS: {},
  enrichMarkets: (markets: Array<{ name: string; type: string }>) =>
    markets.map((market) => ({ market, categories: ["crypto"], subCategory: null })),
  getMarketBaseAsset: (market: { name: string }) => market.name,
  getMarketDisplayName: (market: { name: string }) => market.name,
  useMarketData: () => ({
    data: { perp: perpMarkets, spotTokenNames: {} },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useMarketStats: () => ({
    data: Object.fromEntries(
      perpMarkets.map((market, index) => [
        market.name,
        { change24h: 1, dayNtlVlm: perpMarkets.length - index, markPx: "100" },
      ]),
    ),
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("../components/BalanceHero", () => ({
  BalanceHero: () => <div>Balance Hero</div>,
}));

vi.mock("../components/CategoryPills", () => ({
  CategoryPills: () => <div>Categories</div>,
}));

vi.mock("../components/MarketListItem", () => ({
  MarketListItem: ({ displayName }: { displayName: string }) => (
    <div data-testid="market-row">{displayName}</div>
  ),
}));

vi.mock("../components/MarketListItemSkeleton", () => ({
  MarketListItemSkeleton: () => <div>Loading row</div>,
}));

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

function rowCount() {
  return screen.queryAllByTestId("market-row").length;
}

describe("HomePage", () => {
  beforeEach(() => {
    perpMarkets = [
      { name: "BTC", maxLeverage: 50 },
      { name: "ETH", maxLeverage: 25 },
    ];
  });

  afterEach(cleanup);

  // 419bbb1 removed the SearchSheet and AllMarketsSheet and moved discovery
  // inline. The expansion below is inline too — this stays here so a future
  // change has to argue with that decision rather than drift past it.
  it("keeps market discovery inline rather than in a search or all-markets sheet", () => {
    renderHome();

    expect(screen.getByRole("searchbox", { name: "Search markets" })).toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search markets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See all" })).not.toBeInTheDocument();
  });

  it("offers no expansion when the list already fits", () => {
    renderHome();

    expect(rowCount()).toBe(2);
    expect(screen.queryByRole("button", { name: /See all/ })).not.toBeInTheDocument();
  });

  it("caps the first paint and offers the rest", () => {
    perpMarkets = makeMarkets(404);

    renderHome();

    expect(rowCount()).toBe(HOME_MARKET_LIMIT);
    expect(
      screen.getByRole("button", { name: "See all 404 markets" }),
    ).toBeInTheDocument();
  });

  it("renders the whole list once the user asks for it", () => {
    perpMarkets = makeMarkets(404);

    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "See all 404 markets" }));

    expect(rowCount()).toBe(404);
    expect(screen.queryByRole("button", { name: /See all/ })).not.toBeInTheDocument();
  });

  // Otherwise a search run from an expanded list would hand back every match
  // at once, which is the state this cap exists to avoid.
  it("collapses again when the query changes", () => {
    perpMarkets = makeMarkets(404);

    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "See all 404 markets" }));
    expect(rowCount()).toBe(404);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search markets" }), {
      target: { value: "C" },
    });

    expect(rowCount()).toBe(HOME_MARKET_LIMIT);
  });
});
