// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../locales/en.json";
import { PointsPage } from "./PointsPage";

// The API envelope's `error` string lands on RewardsApiError.message verbatim.
// Production has answered this exact text for a user whose row predates the
// telegram_id migration, so it is the realistic worst case rather than a
// hypothetical one.
const POSTGRES_LEAK =
  'null value in column "telegram_id" of relation "users" violates not-null constraint';

const fetchRewardsDashboard = vi.fn();
const warn = vi.fn();
let currentUser: { id: string; wallet: { address: string } } | null = null;

// Resolve against the real en.json rather than echoing the key back. A key the
// page renders but never defines is precisely the bug this page shipped with —
// t("errors.generic") printed "errors.generic" at users — so the test has to be
// able to see it.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const value = key
        .split(".")
        .reduce<unknown>(
          (acc, part) =>
            acc && typeof acc === "object"
              ? (acc as Record<string, unknown>)[part]
              : undefined,
          en,
        );

      if (typeof value !== "string") {
        throw new Error(`Missing translation key: ${key}`);
      }

      return value;
    },
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: currentUser }),
  useToken: () => ({ getAccessToken: async () => "access-token" }),
}));

vi.mock("../lib/rewards", () => ({
  fetchRewardsDashboard: (...args: unknown[]) => fetchRewardsDashboard(...args),
}));

vi.mock("../lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PointsPage />
    </QueryClientProvider>,
  );
}

describe("PointsPage", () => {
  beforeEach(() => {
    currentUser = { id: "did:privy:abc", wallet: { address: "0xabc" } };
    fetchRewardsDashboard.mockReset();
    warn.mockReset();
  });

  afterEach(cleanup);

  it("shows human copy instead of the server's error text when the dashboard fails", async () => {
    fetchRewardsDashboard.mockRejectedValue(new Error(POSTGRES_LEAK));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.errors.somethingWentWrong)).toBeInTheDocument();
    });

    expect(screen.getByText(en.points.loadFailed)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(POSTGRES_LEAK);
    expect(document.body.textContent).not.toContain("telegram_id");
    expect(document.body.textContent).not.toContain("violates");
  });

  it("keeps the real failure reason in the log", async () => {
    const error = new Error(POSTGRES_LEAK);
    fetchRewardsDashboard.mockRejectedValue(error);

    renderPage();

    await waitFor(() => expect(warn).toHaveBeenCalled());

    expect(warn).toHaveBeenCalledWith(
      "[points] Rewards dashboard failed to load",
      { error },
    );
  });

  it("retries the request from the error state", async () => {
    fetchRewardsDashboard.mockRejectedValue(new Error(POSTGRES_LEAK));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.common.retry)).toBeInTheDocument();
    });

    expect(fetchRewardsDashboard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(en.common.retry));

    await waitFor(() => {
      expect(fetchRewardsDashboard).toHaveBeenCalledTimes(2);
    });
  });

  // The query is disabled until Privy resolves a user, and a disabled query
  // reports isLoading false — which used to fall straight through to the error
  // card during sign-in, before anything had failed.
  it("waits rather than reporting an error while sign-in is still resolving", async () => {
    currentUser = null;

    renderPage();

    await waitFor(() => {
      expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    expect(screen.queryByText(en.errors.somethingWentWrong)).not.toBeInTheDocument();
    expect(fetchRewardsDashboard).not.toHaveBeenCalled();
  });
});
