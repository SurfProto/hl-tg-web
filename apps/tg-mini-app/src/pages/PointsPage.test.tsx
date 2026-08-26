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

vi.mock("../components/ReferralCard", () => ({
  ReferralCard: () => null,
}));

vi.mock("../lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: vi.fn(),
  },
}));

/** A dashboard as the XP-only server actually returns one. */
function xpOnlyDashboard(overrides: Record<string, unknown> = {}) {
  return {
    season: {
      seasonId: "season-1",
      name: "Season One",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
      xpTotal: 1200,
      questXpTotal: 700,
      volumeXpTotal: 500,
      referralXpTotal: 250,
      eligibleVolume: 4200,
      leaderboardRank: 3,
    },
    quests: [
      {
        id: "first_deposit",
        title: "First deposit",
        description: "Fund $50 or more for the first time.",
        status: "completed",
        completedAt: "2026-08-02T00:00:00.000Z",
        progressCurrent: 1,
        progressTarget: 1,
        rewards: [{ amount: 500, kind: "xp", label: "500 XP" }],
      },
    ],
    referral: {
      referralCode: "CODE123",
      referredCount: 2,
      fundedReferralCount: 1,
      hasReferrer: false,
    },
    leaderboard: {
      entries: [
        { alias: "Trader-1C27BA90", eligibleVolume: 5000, isCurrentUser: false, rank: 1, xp: 900 },
        { alias: "Trader-38C6CBD2", eligibleVolume: 1000, isCurrentUser: true, rank: 2, xp: 500 },
      ],
      userRank: 3,
    },
    weeklyRaffle: { state: "paused" },
    rewardHistory: [],
    sync: { lastSyncedAt: "2026-08-24T12:00:00.000Z", retentionRisk: false, state: "synced" },
    programStatus: {
      mode: "xp_only",
      usdcPayoutsEnabled: false,
      weeklyRaffleEnabled: false,
    },
    ...overrides,
  };
}

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

  it("tells the user the program is XP-only", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.xpOnlyNotice)).toBeInTheDocument();
    });
  });

  /**
   * The notice follows the server's capability flag, not the mode name and not
   * a build-time constant, so restoring payouts is a server change alone and a
   * cached bundle cannot keep showing a stale one.
   */
  it("drops the notice when the server re-enables payouts", async () => {
    fetchRewardsDashboard.mockResolvedValue(
      xpOnlyDashboard({
        programStatus: {
          mode: "xp_only",
          usdcPayoutsEnabled: true,
          weeklyRaffleEnabled: false,
        },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.questXp)).toBeInTheDocument();
    });

    expect(screen.queryByText(en.points.xpOnlyNotice)).not.toBeInTheDocument();
  });

  // Quests granted a USDC reward alongside XP, and the card renders only the
  // first entry — so "5 USDC" was the single reward most users ever saw for a
  // quest whose ledger rows are now XP.
  it("promises no cash reward on a quest card", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    // "500 XP" also appears in the leaderboard rows, so match all of them.
    await waitFor(() => {
      expect(screen.getAllByText("500 XP").length).toBeGreaterThan(0);
    });

    expect(document.body.textContent).not.toContain("USDC");
  });

  /**
   * Trades are ingested on a schedule now, not while this screen is open, so a
   * user who just traded can legitimately be looking at an incomplete total.
   * Showing a confident zero instead would read as "you earned nothing".
   */
  it("says totals are still being counted before a first sync", async () => {
    fetchRewardsDashboard.mockResolvedValue(
      xpOnlyDashboard({
        sync: { lastSyncedAt: null, retentionRisk: false, state: "syncing" },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.syncing)).toBeInTheDocument();
    });
  });

  it("says totals may be behind when ingestion is lagging", async () => {
    fetchRewardsDashboard.mockResolvedValue(
      xpOnlyDashboard({
        sync: { lastSyncedAt: "2026-08-20T00:00:00.000Z", retentionRisk: false, state: "stale" },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.syncStale)).toBeInTheDocument();
    });
  });

  it("stays quiet about syncing once it is up to date", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.questXp)).toBeInTheDocument();
    });

    expect(screen.queryByText(en.points.syncing)).not.toBeInTheDocument();
    expect(screen.queryByText(en.points.syncStale)).not.toBeInTheDocument();
  });

  /**
   * The hero showed "TIER n · WAVE RIDER" and a progress bar, both computed as
   * arithmetic on the XP total — xpTotal / 5000 — with no backend tier model
   * behind them. It invented a rank the program does not have and a threshold
   * nobody defined.
   */
  it("shows no invented tier or progress-to-next", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.questXp)).toBeInTheDocument();
    });

    expect(document.body.textContent).not.toContain("TIER");
    expect(document.body.textContent).not.toContain("WAVE RIDER");
    expect(document.body.textContent).not.toContain("TO NEXT");
  });

  // Season volume XP was labelled "this week".
  it("does not label the season total as weekly", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.questXp)).toBeInTheDocument();
    });

    expect(document.body.textContent).not.toContain("this week");
  });

  /**
   * The leaderboard sent every viewer the other traders' Telegram usernames,
   * falling back to a six-character wallet prefix.
   */
  it("shows other traders only by alias", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Trader-1C27BA90")).toBeInTheDocument();
    });

    expect(document.body.textContent).not.toContain("0x");
    // The caller's own row is named for them rather than by their alias.
    expect(screen.getByText(en.points.you)).toBeInTheDocument();
    expect(screen.queryByText("Trader-38C6CBD2")).not.toBeInTheDocument();
  });

  // The referral card multiplied the funded count by 100, a rule the ledger
  // does not apply. It now shows the XP the server actually granted.
  it("shows referral XP the server reported, not a guess", async () => {
    const base = xpOnlyDashboard();
    fetchRewardsDashboard.mockResolvedValue({
      ...base,
      referral: {
        referralCode: "CODE123",
        referredCount: 9,
        fundedReferralCount: 7,
        hasReferrer: false,
      },
      // Quest XP moved off 700 so the old count * 100 figure is unambiguous.
      season: { ...base.season, questXpTotal: 300, referralXpTotal: 250 },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.questXp)).toBeInTheDocument();
    });

    // 7 * 100 = 700 would have been the old invented figure.
    expect(screen.getByText("+250")).toBeInTheDocument();
    expect(screen.queryByText("+700")).not.toBeInTheDocument();
  });

  // The card labelled "Days active" was subtitled with the weekly raffle rank
  // formatted as "N of 7", over a figure that was season quest XP all along.
  it("shows no raffle rank where the quest XP card used to imply one", async () => {
    fetchRewardsDashboard.mockResolvedValue(xpOnlyDashboard());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(en.points.questXp)).toBeInTheDocument();
    });

    expect(document.body.textContent).not.toContain("of 7");
    expect(screen.queryByText(en.points.tradingVolume)).toBeInTheDocument();
  });
});
