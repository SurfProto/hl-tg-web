// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
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
const mockUseUserState = vi.fn();
const closePositionMutate = vi.fn();
let closePositionPending = false;

function position(coin: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "oneWay",
    position: {
      coin,
      szi: 0.5,
      leverage: { type: "cross", value: 10 },
      entryPx: 90,
      positionValue: 50,
      unrealizedPnl: 5.25,
      returnOnEquity: 0.1111,
      liquidationPx: 60,
      marginUsed: 4.5,
      maxLeverage: 50,
      ...overrides,
    },
  };
}

function translate(key: string) {
  return (
    {
      "coinDetail.spot": "SPOT",
      "coinDetail.volume24h": "24h Volume",
      "coinDetail.openInterest": "Open Interest",
      "coinDetail.fundingRate": "Funding Rate",
      "coinDetail.holdings": "Holdings",
      "coinDetail.holdingsValue": "Holdings Value",
      // These carry their arrows in the locale files. The mock used to omit
      // them while the JSX appended its own, so the assertion below passed on
      // a name the app never actually rendered — it showed "Long ↑ ↑".
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
      "coinDetail.yourPosition": "Your position",
      "coinDetail.positionSide": "Side",
      "coinDetail.positionSize": "Size",
      "coinDetail.positionEntry": "Entry price",
      "coinDetail.positionPnl": "Unrealized PnL",
      "coinDetail.positionLiquidation": "Liquidation price",
      "coinDetail.positionLeverage": "Leverage",
      "coinDetail.closePosition": "Close position",
      "common.retry": "Retry",
      "common.loading": "Loading...",
      "common.long": "Long",
      "common.short": "Short",
      "common.closing": "Closing...",
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
      i18n: { language: "en" },
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
  useUserState: () => mockUseUserState(),
  useClosePosition: () => ({
    mutate: closePositionMutate,
    isPending: closePositionPending,
  }),
}));

vi.mock("../hooks/useHaptics", () => ({
  useHaptics: () => ({
    light: vi.fn(),
    medium: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
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
    mockUseUserState.mockReturnValue({ data: { assetPositions: [] } });
    closePositionMutate.mockClear();
    closePositionPending = false;
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
          { key: "15m", label: "15m" },
          { key: "1h", label: "1H" },
          { key: "4h", label: "4H" },
          { key: "1d", label: "1D" },
          { key: "1w", label: "1W" },
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "inspect" }));

    expect(screen.getByText("Open")).toBeInTheDocument();
    // formatUsdPrice, shared with the market rows: two decimals at this
    // magnitude. The page used to carry its own formatter that rendered four.
    expect(screen.getByText("$111.00")).toBeInTheDocument();
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

  /**
   * Spot keeps its holdings view but offers no trade actions: trading is
   * perps-only (TradePage resolves perp markets exclusively), so the Buy/Sell
   * pair this screen used to render for spot symbols was a dead end — every
   * tap landed on "market metadata unavailable".
   */
  it("keeps spot-specific holdings but offers no trade actions for spot", () => {
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
    expect(screen.queryByRole("button", { name: "Sell" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  });

  /**
   * The exposure a trader has to the market they are looking at, on the screen
   * where they decide what to do about it. This page used to say nothing about
   * positions at all, so the only way to see one — or close it — was to leave.
   */
  it("shows the open position for the market on screen", () => {
    mockUseUserState.mockReturnValue({
      data: { assetPositions: [position("BTC")] },
    });

    renderPage("/coin/BTC");

    expect(screen.getByText("Your position")).toBeInTheDocument();
    expect(screen.getByText("Long")).toBeInTheDocument();
    expect(screen.getByText("0.5 BTC")).toBeInTheDocument();
    expect(screen.getByText("$90.00")).toBeInTheDocument();
    expect(screen.getByText("+$5.25 · +11.11%")).toBeInTheDocument();
    expect(screen.getByText("$60.00")).toBeInTheDocument();
    expect(screen.getByText("10×")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close position" }),
    ).toBeInTheDocument();
  });

  // No position, no card: an empty state here would only push the market stats
  // down the page for the majority of visitors, who hold nothing.
  it("says nothing at all when the user holds no position here", () => {
    renderPage("/coin/BTC");

    expect(screen.queryByText("Your position")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close position" }),
    ).not.toBeInTheDocument();
  });

  /**
   * A HIP-3 market's coin carries its dex, `xyz:GOLD-USDC`, and the dex is part
   * of the market's identity: a position on the bare `GOLD-USDC` belongs to a
   * different market and must not be reported as this one's.
   */
  it("matches a HIP-3 position by its whole prefixed symbol", () => {
    mockUseMarketData.mockReturnValue({
      data: {
        perp: [{ name: "xyz:GOLD-USDC", maxLeverage: 10 }],
        spot: [],
      },
    });
    mockUseUserState.mockReturnValue({
      data: {
        assetPositions: [
          position("GOLD-USDC", { szi: 3 }),
          position("xyz:GOLD-USDC", {
            szi: -2,
            unrealizedPnl: -4.25,
            returnOnEquity: -0.1111,
          }),
        ],
      },
    });

    renderPage(`/coin/${encodeURIComponent("xyz:GOLD-USDC")}`);

    expect(screen.getByText("Short")).toBeInTheDocument();
    expect(screen.queryByText("Long")).not.toBeInTheDocument();
    expect(screen.getByText("−$4.25 · -11.11%")).toBeInTheDocument();
  });

  it("does not lend a prefixed position to the bare market's page", () => {
    mockUseUserState.mockReturnValue({
      data: { assetPositions: [position("xyz:BTC")] },
    });

    renderPage("/coin/BTC");

    expect(screen.queryByText("Your position")).not.toBeInTheDocument();
  });

  /**
   * The app's own liquidation estimate is optimistic in the direction that
   * costs money, so the row shows the exchange's figure or nothing at all.
   */
  it("omits liquidation entirely when the exchange reports none", () => {
    mockUseUserState.mockReturnValue({
      data: { assetPositions: [position("BTC", { liquidationPx: null })] },
    });

    renderPage("/coin/BTC");

    expect(screen.getByText("Entry price")).toBeInTheDocument();
    expect(screen.queryByText("Liquidation price")).not.toBeInTheDocument();
  });

  // Closing goes out under the exchange's own coin, prefix and all — the route
  // param may be spelled either way, the order may not.
  it("closes the position under the coin the exchange knows", () => {
    mockUseMarketData.mockReturnValue({
      data: { perp: [{ name: "xyz:GOLD-USDC", maxLeverage: 10 }], spot: [] },
    });
    mockUseUserState.mockReturnValue({
      data: { assetPositions: [position("xyz:GOLD-USDC")] },
    });

    renderPage(`/coin/${encodeURIComponent("GOLD-USDC:xyz")}`);

    fireEvent.click(screen.getByRole("button", { name: "Close position" }));

    expect(closePositionMutate).toHaveBeenCalledWith(
      "xyz:GOLD-USDC",
      expect.anything(),
    );
  });

  // One close in flight is enough; a second tap would send a second order.
  it("bars a second close while the first is in flight", () => {
    closePositionPending = true;
    mockUseUserState.mockReturnValue({
      data: { assetPositions: [position("BTC")] },
    });

    renderPage("/coin/BTC");

    expect(screen.getByRole("button", { name: "Closing..." })).toBeDisabled();
  });
});
