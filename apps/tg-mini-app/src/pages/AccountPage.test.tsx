// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "./AccountPage";

let userStateResult: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: true,
};

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: { wallet: { address: "0x1234567890abcdef1234567890abcdef12345678" } } }),
  useWallets: () => ({ wallets: [] }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../hooks/useHaptics", () => ({ useHaptics: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("@repo/hyperliquid-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hyperliquid-sdk")>()),
  useUserState: () => userStateResult,
  useArbitrumUsdcBalance: () => ({ data: 58.36, isLoading: false }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>,
  );

// The page used to render formatUsd(0) - a confirmed "$0.00" - whenever the
// snapshot query had errored with nothing loaded. The hero never did.
describe("AccountPage balance card", () => {
  afterEach(cleanup);

  it("says 'unavailable' in all four cells, and never $0.00, when the first load errored", () => {
    userStateResult = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getAllByText("balanceHero.balanceUnavailable")).toHaveLength(4);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("keeps showing a held balance when a later refetch errored - the hero's contract", () => {
    userStateResult = {
      data: {
        marginSummary: { accountValue: 410, totalMarginUsed: 0 },
        availableBalance: 275,
        withdrawableBalance: 275,
        visibleStableBalances: [],
      },
      isLoading: false,
      isError: true,
    };
    renderPage();
    expect(screen.getByText("$410.00")).toBeInTheDocument();
    expect(screen.queryByText("balanceHero.balanceUnavailable")).toBeNull();
  });
});
