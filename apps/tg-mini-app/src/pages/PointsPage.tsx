import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy, useToken } from "@privy-io/react-auth";
import type { ReferralSummary, RewardsDashboard } from "@repo/types";
import { useTranslation } from "react-i18next";
import { ReferralCard } from "../components/ReferralCard";
import { getTelegramStartParam } from "../lib/referrals";
import { applyReferralCode, checkIn, fetchRewardsDashboard } from "../lib/rewards";
import { log } from "../lib/logger";

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1_000 ? "compact" : "standard",
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(value);
}

export function PointsPage() {
  const { t } = useTranslation();
  const { user } = usePrivy();
  const { getAccessToken } = useToken();
  const queryClient = useQueryClient();
  const startParam = getTelegramStartParam();
  const walletAddress = user?.wallet?.address ?? null;

  const accessTokenQuery = useQuery({
    queryKey: ["rewardsAccessToken", user?.id],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }

      return accessToken;
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const dashboardQuery = useQuery({
    queryKey: ["rewardsDashboard", walletAddress],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }

      return fetchRewardsDashboard(accessToken);
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const dashboard = dashboardQuery.data;

  /**
   * Apply a referral arriving on a Telegram invite link.
   *
   * The link's code used to be handed to the dashboard, which linked the
   * referrer while serving the read. Making that endpoint read-only removed the
   * behaviour without replacing it, so invite links silently stopped working —
   * the code was captured, sent, and discarded. It now goes to the explicit
   * mutation, which is where a write belongs.
   *
   * Fires once, only when the server confirms there is no referrer yet. Every
   * failure is swallowed: a stale, self-referring or already-used link is an
   * ordinary outcome of sharing links, and none of it is worth an error card in
   * front of someone who just arrived.
   */
  const [claiming, setClaiming] = useState(false);

  /**
   * Claim today's check-in.
   *
   * Safe to press twice — the server keys the grant by UTC date and returns the
   * same state rather than an error — so this needs no guard beyond not showing
   * a spinner forever.
   */
  const claimCheckIn = async () => {
    setClaiming(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      await checkIn(accessToken);
      await queryClient.invalidateQueries({ queryKey: ["rewardsDashboard"] });
    } catch (error) {
      log.warn("[points] Check-in failed", { error });
    } finally {
      setClaiming(false);
    }
  };

  const referralAttempted = useRef(false);

  useEffect(() => {
    if (!startParam || referralAttempted.current) return;
    if (!dashboard || dashboard.referral.hasReferrer) return;

    referralAttempted.current = true;

    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return;

        await applyReferralCode(accessToken, { referralCode: startParam });
        await queryClient.invalidateQueries({ queryKey: ["rewardsDashboard"] });
      } catch (error) {
        log.info("[points] Referral link not applied", { error });
      }
    })();
  }, [startParam, dashboard, getAccessToken, queryClient]);

  // The copy rendered below is deliberately generic. This endpoint puts the
  // API envelope's `error` string straight onto RewardsApiError.message, and
  // that string is whatever the server sent — currently including Postgres
  // constraint text like 'null value in column "telegram_id" ... violates
  // not-null constraint'. Keep the real reason in the log, not on the screen.
  useEffect(() => {
    if (!dashboardQuery.error) return;

    log.warn("[points] Rewards dashboard failed to load", {
      error: dashboardQuery.error,
    });
  }, [dashboardQuery.error]);

  const handleReferralApplied = async (referral: ReferralSummary) => {
    queryClient.setQueryData<RewardsDashboard | undefined>(
      ["rewardsDashboard", walletAddress],
      (current) => (current ? { ...current, referral } : current),
    );
    await dashboardQuery.refetch();
  };

  // A disabled query reports isLoading false, and this one stays disabled
  // until Privy resolves a user. Without the user check the error card below
  // renders during sign-in, before anything has actually failed.
  if (!user?.id || dashboardQuery.isLoading) {
    return (
      <div className="editorial-page px-4 py-5">
        <div className="animate-pulse space-y-4">
          <div className="h-48 rounded-3xl bg-surface" />
          <div className="h-32 rounded-2xl bg-surface" />
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-16 rounded-2xl bg-surface" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <div className="editorial-page px-4 py-5">
        <div className="rounded-2xl border border-negative/20 bg-negative/5 p-5 text-center">
          <p className="text-sm font-semibold text-negative">
            {t("errors.somethingWentWrong")}
          </p>
          <p className="mt-1 text-sm text-muted">{t("points.loadFailed")}</p>
          <button
            type="button"
            onClick={() => void dashboardQuery.refetch()}
            className="editorial-button-primary mt-4"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="editorial-page">
      <div className="editorial-shell">
        <div>
          <h1 className="editorial-heading text-foreground">{t("nav.rewards")}</h1>
        </div>

        {/*
          Rendered from the server's descriptor rather than from a build-time
          flag, so a cached bundle cannot keep promising a payout the API has
          already stopped making. The condition is on the capability, not on
          the mode name, so restoring payouts is a server change alone.
        */}
        {!dashboard.programStatus.usdcPayoutsEnabled && (
          <div
            role="status"
            className="mt-4 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-muted"
          >
            {t("points.xpOnlyNotice")}
          </div>
        )}

        {/*
          Trades are ingested on a schedule now rather than while this screen is
          open, so the totals below can legitimately lag a trade the user just
          made. Saying so is the honest alternative to showing a confident zero.
          "error" deliberately reads the same as "stale": the user's move is to
          wait either way, and the distinction belongs in the run log.
        */}
        {dashboard.sync.state !== "synced" && (
          <div
            role="status"
            className="mt-3 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-muted"
          >
            {dashboard.sync.state === "syncing"
              ? t("points.syncing")
              : t("points.syncStale")}
          </div>
        )}

        <div className="mt-5 rounded-[20px] bg-primary p-5 text-white">
          <div className="editorial-kicker flex items-center justify-between text-white/55">
            <span>{dashboard.season.name} · YOUR POINTS</span>
            <span className="uppercase">{t(`points.ranks.${dashboard.tier.rank}`)}</span>
          </div>
          <div className="editorial-display mt-3">
            {formatCompactNumber(dashboard.season.xpTotal)}
          </div>
          {/*
            volumeXpTotal is the season total, and was labelled "this week".
            The tier bar that used to sit below was arithmetic on that same
            number — xpTotal / 5000, named "WAVE RIDER" — with no backend tier
            model behind it, so it invented both a rank and a next threshold.
            Both are gone until something real defines them.
          */}
          <div className="mt-2 text-sm text-white/70">
            +{formatCompactNumber(dashboard.season.volumeXpTotal)} {t("points.fromTrading")} · {t("points.rank")} #
            {dashboard.season.leaderboardRank ?? "—"}
          </div>

          {/*
            Progress toward a real threshold, unlike the tier bar this replaced —
            that one was arithmetic on the XP total with no backend model behind
            it, so it invented both the rank and the distance to the next one.
          */}
          {dashboard.tier.xpToNextRank != null && dashboard.tier.nextRank && (
            <div className="mt-3 text-xs text-white/55">
              {t("points.toNextRank", {
                count: dashboard.tier.xpToNextRank,
                rank: t(`points.ranks.${dashboard.tier.nextRank}`),
              })}
            </div>
          )}
        </div>

        {/*
          The one thing here that rewards showing up rather than trading. The
          streak is derived from dated ledger rows, so what is displayed cannot
          drift from what was actually granted.
        */}
        <button
          type="button"
          onClick={claimCheckIn}
          disabled={claiming || !dashboard.streak.availableToday}
          className="editorial-card mt-3 flex w-full items-center justify-between px-4 py-4 text-left disabled:opacity-70"
        >
          <div>
            <div className="editorial-section-title">
              {dashboard.streak.availableToday
                ? claiming
                  ? t("points.checkInPending")
                  : t("points.checkIn")
                : t("points.checkInClaimed")}
            </div>
            {dashboard.streak.currentDays > 0 && (
              <div className="mt-1 text-sm text-muted">
                {t("points.streakDays", { count: dashboard.streak.currentDays })}
              </div>
            )}
          </div>
          <div className="editorial-mono text-lg font-semibold text-positive">
            +{formatCompactNumber(dashboard.streak.nextRewardXp)}
          </div>
        </button>

        {user?.id && accessTokenQuery.data && (
          <div className="pt-4">
            <ReferralCard
              accessToken={accessTokenQuery.data}
              onApplied={handleReferralApplied}
              referral={dashboard.referral}
            />
          </div>
        )}

        <div className="pb-2 pt-6">
          <div className="editorial-kicker">{t("points.thisWeek")}</div>
        </div>
        <div className="space-y-3">
          <div className="editorial-card flex items-center justify-between px-4 py-4">
            <div>
              <div className="editorial-section-title">{t("points.tradingVolume")}</div>
              <div className="mt-1 text-sm text-muted">{formatUsd(dashboard.season.eligibleVolume)}</div>
            </div>
            <div className="editorial-mono text-lg font-semibold text-positive">
              +{formatCompactNumber(dashboard.season.volumeXpTotal)}
            </div>
          </div>
          {/*
            This card showed "Days active", subtitled with the raffle rank
            formatted as "N of 7", above a figure that was neither: the value
            has always been season quest XP. There is no raffle rank to read
            any more — weeklyRaffle carries no ranking while payouts are
            paused — so the label now names what the number is.
          */}
          <div className="editorial-card flex items-center justify-between px-4 py-4">
            <div>
              <div className="editorial-section-title">{t("points.questXp")}</div>
              <div className="mt-1 text-sm text-muted">
                {dashboard.quests.filter((quest) => quest.status === "completed").length}/
                {dashboard.quests.length}
              </div>
            </div>
            <div className="editorial-mono text-lg font-semibold text-positive">
              +{formatCompactNumber(dashboard.season.questXpTotal)}
            </div>
          </div>
          <div className="editorial-card flex items-center justify-between px-4 py-4">
            <div>
              <div className="editorial-section-title">{t("points.friendsJoined")}</div>
              <div className="mt-1 text-sm text-muted">{dashboard.referral.fundedReferralCount}</div>
            </div>
            {/*
              This multiplied the funded-referral count by 100 — a number that
              matched no rule the ledger applies. Referral XP is a real total
              the server reports; show that instead of a guess.
            */}
            <div className="editorial-mono text-lg font-semibold text-positive">
              +{formatCompactNumber(dashboard.season.referralXpTotal)}
            </div>
          </div>
        </div>

        {dashboard.quests.length > 0 && (
          <>
            <div className="pb-2 pt-6">
              <div className="editorial-kicker">{t("points.quests")}</div>
            </div>
            <div className="space-y-3">
              {dashboard.quests.map((quest) => (
                <div key={quest.id} className="editorial-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-foreground">{quest.title}</span>
                        {quest.status === "completed" && (
                          <span className="rounded-full bg-positive/10 px-2 py-1 text-xs font-semibold text-positive">
                            {t("common.done")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">{quest.description}</p>
                    </div>
                    <div className="editorial-mono text-sm font-semibold text-foreground">
                      {quest.rewards[0]?.label ?? "—"}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${Math.min(100, (quest.progressCurrent / Math.max(quest.progressTarget, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="editorial-mono mt-2 text-xs text-muted">
                      {quest.progressCurrent}/{quest.progressTarget}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {dashboard.leaderboard.entries.length > 0 && (
          <>
            <div className="pb-2 pt-6">
              <div className="editorial-kicker">{t("points.topTraders")}</div>
            </div>
            <div className="editorial-card divide-y divide-separator overflow-hidden">
              {dashboard.leaderboard.entries.slice(0, 5).map((entry) => (
                <div
                  key={entry.rank}
                  className={`flex items-center justify-between px-4 py-3${
                    entry.isCurrentUser ? " bg-[var(--color-primary-soft)]" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-sm font-bold text-foreground">
                      #{entry.rank}
                    </div>
                    <div>
                      {/* An opaque alias. This showed other traders' Telegram
                          usernames, or a six-character wallet prefix. */}
                      <div className="text-sm font-semibold text-foreground">
                        {entry.isCurrentUser ? t("points.you") : entry.alias}
                      </div>
                      <div className="editorial-mono text-xs text-muted">{formatCompactNumber(entry.xp)} XP</div>
                    </div>
                  </div>
                  <div className="editorial-mono text-sm font-semibold text-foreground">
                    {formatUsd(entry.eligibleVolume)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
