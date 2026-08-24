// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { ReferralCard } from "./ReferralCard";
import { RewardsApiError } from "../lib/rewards";

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
  // Declared inside the factory on purpose: vi.mock is hoisted above the file
  // body, so a class declared outside is still in its temporal dead zone when
  // this runs. The line above survives only because the arrow defers its
  // reference.
  RewardsApiError: class RewardsApiError extends Error {
    code?: string;
    status: number;

    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = "RewardsApiError";
      this.code = code;
      this.status = status;
    }
  },
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

  it("uses the copy written for a referral failure it knows", async () => {
    applyReferralCode.mockRejectedValue(
      new RewardsApiError("whatever the server said", 400, "REFERRAL_CODE_NOT_FOUND"),
    );

    renderCard();
    fireEvent.change(screen.getByLabelText("points.enterReferralCode"), {
      target: { value: "FRIEND99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "points.applyReferralCode" }));

    await waitFor(() => {
      expect(screen.getByText("points.referral.errors.notFound")).toBeInTheDocument();
    });
  });

  // An unmapped code means the server said something this screen has no copy
  // for. That is the same channel that put a Postgres not-null constraint in
  // front of users on the Points tab.
  it("does not put an unmapped server error in front of the user", async () => {
    applyReferralCode.mockRejectedValue(
      new RewardsApiError(
        'null value in column "telegram_id" of relation "users" violates not-null constraint',
        500,
        "SOMETHING_THE_UI_HAS_NEVER_HEARD_OF",
      ),
    );

    renderCard();
    fireEvent.change(screen.getByLabelText("points.enterReferralCode"), {
      target: { value: "FRIEND99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "points.applyReferralCode" }));

    await waitFor(() => {
      expect(screen.getByText("errors.somethingWentWrong")).toBeInTheDocument();
    });

    expect(document.body.textContent).not.toContain("telegram_id");
    expect(document.body.textContent).not.toContain("violates");
  });
});
