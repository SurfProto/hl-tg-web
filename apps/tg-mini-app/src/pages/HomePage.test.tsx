// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "nav.markets": "Markets",
        "home.ariaSearch": "Search markets",
        "home.seeAll": "See all",
        "home.noMarkets": "No markets",
      })[key] ?? key,
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
    data: {
      perp: [
        { name: "BTC", maxLeverage: 50 },
        { name: "ETH", maxLeverage: 25 },
      ],
      spotTokenNames: {},
    },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useMarketStats: () => ({
    data: {
      BTC: { change24h: 2, dayNtlVlm: 1000, markPx: "100" },
      ETH: { change24h: 1, dayNtlVlm: 900, markPx: "90" },
    },
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
  MarketListItem: ({ displayName }: { displayName: string }) => <div>{displayName}</div>,
}));

vi.mock("../components/MarketListItemSkeleton", () => ({
  MarketListItemSkeleton: () => <div>Loading row</div>,
}));

describe("HomePage", () => {
  it("keeps market discovery inline without separate search or all-market actions", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("searchbox", { name: "Search markets" })).toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search markets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See all" })).not.toBeInTheDocument();
  });
});
