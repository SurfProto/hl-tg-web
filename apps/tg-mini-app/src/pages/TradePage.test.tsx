// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradePage } from "./TradePage";

const mutateAsync = vi.fn();
const setupReset = vi.fn();
let canTrade = true;
let authenticated = false;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "trade.newOrder": "New order",
        "trade.buy": "Buy",
        "trade.sell": "Sell",
        "trade.goingLong": "Going long",
        "trade.or": "Or",
        "trade.profitWhenPriceRises": "Profit when price rises",
        "trade.size": "Size",
        "trade.availShort": "Avail.",
        "trade.leverage": "Leverage",
        "trade.liq": "Liq.",
        "trade.fee": "Fee",
        "trade.margin": "Margin",
        "trade.reviewOrder": "Review order",
        "trade.confirmOrder": "Confirm order",
        "trade.orderResult": "Order result",
        "trade.orderPlacedTitle": "Order placed",
        "trade.orderPlacedBody": "Submitted to Hyperliquid",
        "trade.viewPositions": "View positions",
        "trade.returnHome": "Return home",
        "trade.market": "Market",
        "trade.side": "Side",
        "trade.orderType": "Order type",
        "common.long": "Long",
        "common.short": "Short",
      })[key] ?? key,
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ authenticated, user: { wallet: { address: "0x1" } } }),
}));

vi.mock("@repo/hyperliquid-sdk", () => ({
  getMarketBaseAsset: () => "BTC",
  getAvailableCollateralForMarket: () => 1000,
  getMarketDisplayName: () => "BTC",
  useMarketData: () => ({
    data: {
      perp: [{ name: "BTC", maxLeverage: 50, minNotionalUsd: 10 }],
    },
  }),
  useMarketPrice: () => ({ data: 100, isError: false, isLoading: false }),
  usePlaceOrder: () => ({ mutateAsync, isPending: false }),
  useSetupTrading: () => ({
    status: { canTrade, blockingSteps: canTrade ? [] : ["approval"], isAgentExpired: false },
    setup: { reset: setupReset },
  }),
  useUpsertPositionProtection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUserState: () => ({
    data: { abstractionMode: "main", stableBalances: [], withdrawableBalance: 1000, assetPositions: [] },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
  validateOrderInput: () => ({ isValid: true, minMarginUsd: 1, minSizeUsd: 10 }),
}));

vi.mock("../components/NumPad", () => ({
  NumPad: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("100")}>Enter amount</button>
  ),
}));

vi.mock("../components/ProtectionSheet", () => ({ ProtectionSheet: () => null }));
vi.mock("../components/TokenIcon", () => ({ TokenIcon: () => <span>BTC icon</span> }));
vi.mock("../components/TradingSetupSheet", () => ({
  TradingSetupSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>Trading setup required</div> : null,
}));
vi.mock("../hooks/useHaptics", () => ({
  useHaptics: () => ({
    error: vi.fn(),
    light: vi.fn(),
    medium: vi.fn(),
    selection: vi.fn(),
    success: vi.fn(),
  }),
}));
vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

function renderTrade() {
  return render(
    <MemoryRouter initialEntries={["/trade/BTC?side=long"]}>
      <Routes>
        <Route path="/trade/:symbol" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TradePage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    canTrade = true;
    authenticated = false;
    mutateAsync.mockResolvedValue({});
  });

  it("advances to review without placing an order", () => {
    renderTrade();

    fireEvent.click(screen.getByRole("button", { name: "Enter amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));

    expect(screen.getByRole("heading", { name: "Review order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm order" })).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();

    // Both header slots used to render trade.reviewOrder, so the screen read
    // "REVIEW ORDER" above "Review order".
    expect(screen.getAllByText("Review order")).toHaveLength(1);
  });

  // The new-order title was a <span>, so this screen had no heading element at
  // all, with the same string repeated above it as a kicker.
  it("gives the order screen a single heading", () => {
    renderTrade();

    expect(screen.getByRole("heading", { name: "New order" })).toBeInTheDocument();
    expect(screen.getAllByText("New order")).toHaveLength(1);
  });

  it("submits only after confirmation and presents result actions", async () => {
    renderTrade();

    fireEvent.click(screen.getByRole("button", { name: "Enter amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Order placed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View positions" })).toBeInTheDocument();
  });

  it("keeps the reviewed order intact when trading setup blocks confirmation", () => {
    canTrade = false;
    authenticated = true;
    renderTrade();

    fireEvent.click(screen.getByRole("button", { name: "Enter amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    expect(screen.getByText("Trading setup required")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review order" })).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
