import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoinDetailPage } from "./CoinDetailPage";

const chartSpy = vi.fn();
const mockUseMarketData = vi.fn();
const mockUseMarketPrice = vi.fn();
const mockUseAssetCtx = vi.fn();
const mockUseCandles = vi.fn();
const mockUseSpotBalance = vi.fn();
const mockUseMids = vi.fn();

function translate(key: string) {
  return (
    {
      "coinDetail.perp": "PERP",
      "coinDetail.spot": "SPOT",
      "coinDetail.pastDay": "past day",
      "coinDetail.change24h": "24h Change",
      "coinDetail.volume24h": "24h Volume",
      "coinDetail.openInterest": "Open Interest",
      "coinDetail.fundingRate": "Funding Rate",
      "coinDetail.holdings": "Holdings",
      "coinDetail.holdingsValue": "Holdings Value",
      "coinDetail.marketCap": "Market Cap",
      "coinDetail.longButton": "Long ↑",
      "coinDetail.shortButton": "Short ↓",
      "coinDetail.buyButton": "Buy",
      "coinDetail.sellButton": "Sell",
      "coinDetail.open": "Open",
      "coinDetail.high": "High",
      "coinDetail.low": "Low",
      "coinDetail.vol": "Vol",
      "coinDetail.loadingMarketPrice": "Loading market price...",
      "coinDetail.marketPriceUnavailable": "Market price unavailable.",
      "coinDetail.marketStatsUnavailable": "Market stats unavailable.",
      "common.retry": "Retry",
      "common.loading": "Loading...",
    } as Record<string, string>
  )[key] ?? key;
}

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next",
  );

  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
    }),
  };
});

vi.mock("@repo/hyperliquid-sdk", () => ({
  getMarketBaseAsset: (market: { name?: string } | string) =>
    typeof market === "string"
      ? market.split("-")[0]
      : (market.name ?? "BTC").split("-")[0],
  getMarketDisplayName: (market: { name?: string } | string) =>
    typeof market === "string" ? market : market.name ?? "BTC",
  useMarketData: () => mockUseMarketData(),
  useMarketPrice: (coin: string) => mockUseMarketPrice(coin),
  useAssetCtx: (coin: string) => mockUseAssetCtx(coin),
  useCandles: (coin: string, interval: string) => mockUseCandles(coin, interval),
  useSpotBalance: () => mockUseSpotBalance(),
  useMids: () => mockUseMids(),
}));

vi.mock("@repo/ui", () => ({
  Chart: (props: Record<string, unknown>) => {
    chartSpy(props);

    return (
      <div data-testid="chart-mock">
        <button
          type="button"
          onClick={() =>
            (props.onLiteCandleInspect as undefined | ((value: unknown) => void))?.({
              candle: {
                t: Date.UTC(2026, 3, 10, 12, 0, 0),
                T: Date.UTC(2026, 3, 10, 12, 15, 0),
                o: 100,
                h: 111,
                l: 95,
                c: 105,
                v: 2500,
              },
              x: 120,
              y: 120,
              containerWidth: 320,
              containerHeight: 248,
            })
          }
        >
          inspect
        </button>
      </div>
    );
  },
}));

function renderPage(initialEntry = "/coin/BTC") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/coin/:symbol" element={<CoinDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CoinDetailPage", () => {
  beforeEach(() => {
    chartSpy.mockClear();
    mockUseMarketData.mockReturnValue({
      data: {
        perp: [{ name: "BTC", maxLeverage: 50 }],
        spot: [{ name: "HYPE-USD", maxLeverage: 1 }],
      },
    });
    mockUseMarketPrice.mockReturnValue({
      data: 100,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseAssetCtx.mockReturnValue({
      data: {
        change24h: 4.2,
        dayNtlVlm: 1_250_000,
        openInterest: 10_000,
        funding: 0.0001,
      },
      isLoading: false,
      isError: false,
    });
    mockUseCandles.mockReturnValue({
      data: [
        {
          t: Date.UTC(2026, 3, 10, 12, 0, 0),
          T: Date.UTC(2026, 3, 10, 12, 15, 0),
          o: 100,
          h: 111,
          l: 95,
          c: 105,
          v: 2500,
        },
      ],
    });
    mockUseSpotBalance.mockReturnValue({
      data: {
        balances: [{ coin: "HYPE", total: "12.5" }],
      },
    });
    mockUseMids.mockReturnValue({
      data: {
        BTC: "100",
        "HYPE-USD": "7.5",
      },
    });
  });

  it("passes lite-candle inspection props to the chart and renders the scrub tooltip", () => {
    renderPage("/coin/BTC");

    expect(chartSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "lite-candles",
        showLastPrice: true,
        zoomPreset: "interval-default",
        enableLiteCandleInspect: true,
        heightClassName: "h-[248px]",
        ranges: [
          { key: "15m", label: "15M" },
          { key: "1h", label: "1H" },
          { key: "4h", label: "4H" },
          { key: "1d", label: "24H" },
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "inspect" }));

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("$111.0000")).toBeInTheDocument();
    expect(screen.getByText("$2.50K")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Short ↓" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Long ↑" }),
    ).toBeInTheDocument();
  });

  it("shows the market price loading state instead of a bare placeholder", () => {
    mockUseMarketPrice.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage("/coin/BTC");

    expect(screen.getByText("Loading market price...")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("keeps spot-specific holdings and buy/sell actions while using the richer coin detail layout", () => {
    mockUseMarketData.mockReturnValue({
      data: {
        perp: [{ name: "BTC", maxLeverage: 50 }],
        spot: [{ name: "HYPE-USD", maxLeverage: 1 }],
      },
    });
    mockUseMarketPrice.mockReturnValue({
      data: 7.5,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage("/coin/HYPE-USD");

    expect(screen.getByText("SPOT")).toBeInTheDocument();
    expect(screen.getByText("Holdings")).toBeInTheDocument();
    expect(screen.getByText("12.5000 HYPE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
  });
});
