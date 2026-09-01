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
        "trade.limitPrice": "Limit price",
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
  getBuilderFeeTenthsBp: () => 50,
  getMarketBaseAsset: () => "BTC",
  getAvailableCollateralForMarket: () => 1000,
  getMarketDisplayName: () => "BTC",
  truncateToDecimals: (value: number) => String(value),
  useUserFees: () => ({ data: { takerRate: 0.00045, makerRate: 0.00015 } }),
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

const sizeInput = () => screen.getByLabelText("Size · USD") as HTMLInputElement;
const priceInput = () =>
  screen.getByLabelText("Limit price") as HTMLInputElement;

function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
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

    typeInto(sizeInput(), "100");
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

  // useSetupTrading hands back a new object every render, so depending on it
  // re-ran the signed-out branch on every render. In the real app reset()
  // notifies the mutation observer, so that render triggered another one and
  // the screen looped until React gave up. The mocked reset here does not
  // re-render, so the loop cannot be reproduced directly — what this pins is
  // the cause: the effect must not re-run just because the page re-rendered.
  it("resets setup once on sign-out, not on every render", () => {
    authenticated = false;

    renderTrade();
    expect(setupReset).toHaveBeenCalledTimes(1);

    // Each of these re-renders the page.
    typeInto(sizeInput(), "100");
    fireEvent.click(screen.getByRole("button", { name: /Sell/ }));

    expect(setupReset).toHaveBeenCalledTimes(1);
  });

  // The other half of the same change: narrowing the dependencies must not
  // stop the effect firing when auth actually changes.
  it("still resets setup when the user signs out", () => {
    authenticated = true;

    const { rerender } = renderTrade();
    expect(setupReset).not.toHaveBeenCalled();

    authenticated = false;
    rerender(
      <MemoryRouter initialEntries={["/trade/BTC?side=long"]}>
        <Routes>
          <Route path="/trade/:symbol" element={<TradePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(setupReset).toHaveBeenCalledTimes(1);
  });

  it("submits only after confirmation and presents result actions", async () => {
    renderTrade();

    typeInto(sizeInput(), "100");
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Order placed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View positions" })).toBeInTheDocument();
  });

  /**
   * The limit price used to be edited on a second step that shared the number
   * pad with the size: the first Review tap silently repointed the pad at the
   * price while the card kept showing the size, nothing gated an untouched
   * price, and the review screen rendered "—" before the SDK errored on
   * submit. Both fields are now on screen together, and the gate stays.
   */
  it("shows the limit price beside the size, and blocks review until one is set", () => {
    renderTrade();

    fireEvent.click(screen.getByRole("tab", { name: "trade.orderTypeLimit" }));
    typeInto(sizeInput(), "100");

    // Both fields are editable at once — no step, nothing to flip between.
    expect(sizeInput()).toBeInTheDocument();
    expect(priceInput()).toBeInTheDocument();
    // No price typed yet — review is gated.
    expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();

    typeInto(priceInput(), "42000.5");
    expect(priceInput().value).toBe("42000.5");

    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    expect(
      screen.getByRole("heading", { name: "Review order" }),
    ).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  // Market orders have no price field to gate on, so the limit gate must not
  // leak into them.
  it("does not show a price field on a market order", () => {
    renderTrade();

    typeInto(sizeInput(), "100");

    expect(screen.queryByLabelText("Limit price")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review order" }),
    ).not.toBeDisabled();
  });

  /**
   * The number pad could not produce a third decimal in the size field: it
   * dropped any key that would have added one. A native input will take
   * whatever is typed, so the same cap is enforced on the way in — and by
   * rejecting the keystroke, never by rounding. Rounding an amount up is why
   * truncateToDecimals exists.
   */
  it("holds the size to two decimals and the price to eight", () => {
    renderTrade();
    fireEvent.click(screen.getByRole("tab", { name: "trade.orderTypeLimit" }));

    typeInto(sizeInput(), "10.12");
    expect(sizeInput().value).toBe("10.12");

    typeInto(sizeInput(), "10.129");
    expect(sizeInput().value).toBe("10.12");

    typeInto(priceInput(), "1.12345678");
    expect(priceInput().value).toBe("1.12345678");

    typeInto(priceInput(), "1.123456789");
    expect(priceInput().value).toBe("1.12345678");
  });

  /**
   * The pad had twelve keys: ten digits, one point, one delete. It could not
   * emit a sign, an exponent or a second decimal point, and a lone "0" was
   * replaced by the next digit rather than kept in front of it. type="number"
   * accepts all of those, and "1e5" parses as 100000.
   */
  it("refuses input the pad could never have produced", () => {
    renderTrade();

    typeInto(sizeInput(), "100");

    typeInto(sizeInput(), "-100");
    expect(sizeInput().value).toBe("100");

    typeInto(sizeInput(), "1e5");
    expect(sizeInput().value).toBe("100");

    typeInto(sizeInput(), "05");
    expect(sizeInput().value).toBe("5");

    // A second decimal point never even reaches the handler: a number input
    // reports a value it cannot parse as "", so the field empties rather than
    // holding the old number. Empty is a state the pad had too, and every gate
    // downstream reads it as a zero size.
    typeInto(sizeInput(), "1.2.3");
    expect(sizeInput().value).toBe("");
    expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();
  });

  /**
   * A native input hands back "" when cleared and can hand back a half-typed
   * "1." — neither may reach an order. Every gate runs on parseFloat(...) || 0,
   * so an unparseable field reads as a zero size and Review stays shut.
   */
  it("keeps review shut on an empty or half-typed size", () => {
    renderTrade();

    typeInto(sizeInput(), "100");
    expect(
      screen.getByRole("button", { name: "Review order" }),
    ).not.toBeDisabled();

    typeInto(sizeInput(), "");
    expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();

    typeInto(sizeInput(), ".");
    expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();
  });

  // The size the exchange is asked for must be the number in the field, not a
  // rounded stand-in for it.
  it("submits the size exactly as typed", async () => {
    renderTrade();

    typeInto(sizeInput(), "10.99");
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sizeUsd: 10.99 }),
    );
  });

  /**
   * placeOrder.isPending disables the button only after React Query's state
   * change re-renders, so two taps landing in the same frame used to both
   * reach mutateAsync — two live orders with two distinct cloids.
   */
  it("places one order however fast Confirm is tapped twice", async () => {
    let release!: () => void;
    mutateAsync.mockImplementation(
      () =>
        new Promise<Record<string, never>>((resolve) => {
          release = () => resolve({});
        }),
    );
    renderTrade();

    typeInto(sizeInput(), "100");
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));

    const confirm = screen.getByRole("button", { name: "Confirm order" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    release();
    await waitFor(() =>
      expect(screen.getByText("Order placed")).toBeInTheDocument(),
    );
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps the reviewed order intact when trading setup blocks confirmation", () => {
    canTrade = false;
    authenticated = true;
    renderTrade();

    typeInto(sizeInput(), "100");
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    expect(screen.getByText("Trading setup required")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review order" })).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
