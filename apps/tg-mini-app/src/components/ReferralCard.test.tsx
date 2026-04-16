// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { ReferralCard } from "./ReferralCard";

const openReferralInvite = vi.fn();
const applyReferralCode = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../lib/referrals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/referrals")>();
  return {
    ...actual,
    openReferralInvite: (...args: unknown[]) => openReferralInvite(...args),
  };
});

vi.mock("../lib/rewards", () => ({
  applyReferralCode: (...args: unknown[]) => applyReferralCode(...args),
}));

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const onApplied = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ReferralCard
          accessToken="access-token"
          referral={{
            referralCode: "FRIEND42",
            referredCount: 3,
            fundedReferralCount: 1,
            hasReferrer: false,
          }}
          onApplied={onApplied}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );

  return { onApplied };
}

describe("ReferralCard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    openReferralInvite.mockResolvedValue("opened");
    applyReferralCode.mockResolvedValue({
      referralCode: "FRIEND42",
      referredCount: 3,
      fundedReferralCount: 1,
      hasReferrer: true,
    });
  });

  it("renders live referral stats and launches invite links", async () => {
    renderCard();

    expect(screen.getByText("FRIEND42")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "points.invite" }));

    await waitFor(() => {
      expect(openReferralInvite).toHaveBeenCalledWith("FRIEND42");
    });
  });

  it("applies a manual referral code and reports success", async () => {
    const { onApplied } = renderCard();

    fireEvent.change(screen.getByLabelText("points.enterReferralCode"), {
      target: { value: "ref-friend99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "points.applyReferralCode" }));

    await waitFor(() => {
      expect(applyReferralCode).toHaveBeenCalledWith("access-token", {
        referralCode: "FRIEND99",
      });
    });
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({ hasReferrer: true }),
      );
    });
  });
});
