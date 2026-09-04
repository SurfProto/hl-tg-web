// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WithdrawPage } from "./WithdrawPage";

const withdrawMutation = {
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
};

// The balance a real account showed when Max offered more than it held:
// toFixed(2) rounds, so 10.996843 became "11.00" and the exchange rejected
// the withdrawal. truncateToDecimals is the actual implementation, not a
// stub — the test pins that Max cuts instead of rounding.
const AVAILABLE = 10.996843;

// What already sits in the Arbitrum wallet the withdrawal is headed for.
const WALLET_USDC = 58.36;

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    user: { wallet: { address: "0x1234567890abcdef1234567890abcdef12345678" } },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@repo/hyperliquid-sdk", async () => {
  const actual = await vi.importActual<typeof import("@repo/hyperliquid-sdk")>(
    "@repo/hyperliquid-sdk",
  );
  return {
    truncateToDecimals: actual.truncateToDecimals,
    useUserState: () => ({
      data: {
        abstractionMode: "standard",
        visibleStableBalances: [],
        stableBalances: { USDC: { available: AVAILABLE } },
        withdrawableBalance: AVAILABLE,
      },
    }),
    useWithdraw: () => withdrawMutation,
    useArbitrumUsdcBalance: () => ({ data: WALLET_USDC }),
  };
});

describe("WithdrawPage", () => {
  afterEach(cleanup);

  it("Max fills an amount the account actually holds", () => {
    render(<WithdrawPage />);

    fireEvent.click(screen.getByText("common.max"));

    const input = screen.getByLabelText<HTMLInputElement>("withdraw.amount");
    expect(input).toHaveValue(10.99);
    expect(parseFloat(input.value)).toBeLessThanOrEqual(AVAILABLE);
  });

  // A withdrawal empties the trading account, so every figure on the account
  // screen correctly reads zero afterwards. Saying where the money went is the
  // difference between that and looking stolen.
  it("says where the money is going before it goes", () => {
    render(<WithdrawPage />);

    expect(screen.getByText("withdraw.destinationHint")).toBeInTheDocument();
  });

  it("shows what the destination wallet holds, so arrival is visible", () => {
    render(<WithdrawPage />);

    expect(screen.getByText("withdraw.walletBalance")).toBeInTheDocument();
    // Truncated, not rounded, for the same reason Max is.
    expect(screen.getByText("withdraw.walletBalanceAmount")).toBeInTheDocument();
  });

  // Max was guarded and typing was not: the raw string went to withdraw3 with
  // no decimal limit and no upper bound.
  describe("what the amount field accepts", () => {
    function typeAmount(value: string) {
      const input = screen.getByLabelText<HTMLInputElement>("withdraw.amount");
      fireEvent.change(input, { target: { value } });
      return input;
    }

    it("takes cents", () => {
      render(<WithdrawPage />);
      expect(typeAmount("10.99")).toHaveValue(10.99);
    });

    it("refuses a third decimal rather than reshaping it", () => {
      render(<WithdrawPage />);
      typeAmount("10.99");
      // Not 10.99 rounded up, not 11 — the keystroke simply does not land.
      expect(typeAmount("10.996")).toHaveValue(10.99);
    });

    it("keeps Withdraw shut on more than the account holds, and says why", () => {
      render(<WithdrawPage />);
      typeAmount("11");

      expect(screen.getByText("withdraw.exceedsBalance")).toBeInTheDocument();
      expect(screen.getByText("withdraw.withdrawButton")).toBeDisabled();
    });

    it("allows the fractional cents Max leaves behind", () => {
      render(<WithdrawPage />);
      // Max offers 10.99; the account actually holds 10.996843.
      typeAmount("10.99");

      expect(screen.queryByText("withdraw.exceedsBalance")).not.toBeInTheDocument();
      expect(screen.getByText("withdraw.withdrawButton")).not.toBeDisabled();
    });

    it("keeps Withdraw shut on an empty or zero amount", () => {
      render(<WithdrawPage />);
      expect(screen.getByText("withdraw.withdrawButton")).toBeDisabled();

      typeAmount("0");
      expect(screen.getByText("withdraw.withdrawButton")).toBeDisabled();
    });
  });
});
