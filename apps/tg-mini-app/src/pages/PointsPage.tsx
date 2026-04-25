import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy, useToken } from "@privy-io/react-auth";
import type { ReferralSummary, RewardsDashboard } from "@repo/types";
import { useTranslation } from "react-i18next";
import { ReferralCard } from "../components/ReferralCard";
import { useHaptics } from "../hooks/useHaptics";
import { getTelegramStartParam } from "../lib/referrals";
import { fetchRewardsDashboard } from "../lib/rewards";
import { getTelegramProfile } from "../lib/supabase";

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
  const haptics = useHaptics();
  const { user } = usePrivy();
  const { getAccessToken } = useToken();
  const queryClient = useQueryClient();
  const telegramProfile = getTelegramProfile();
  const startParam = getTelegramStartParam();
  const username =
    telegramProfile?.username ??
    user?.telegram?.username ??
    user?.email?.address ??
    null;
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
    queryKey: ["rewardsDashboard", walletAddress, startParam],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Missing access token");
      }

      return fetchRewardsDashboard(accessToken, {
        startParam,
        username,
        walletAddress,
      });
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const dashboard = dashboardQuery.data;

  const handleReferralApplied = async (referral: ReferralSummary) => {
    queryClient.setQueryData<RewardsDashboard | undefined>(
      ["rewardsDashboard", walletAddress, startParam],
      (current) => (current ? { ...current, referral } : current),
    );
    await dashboardQuery.refetch();
  };

  const handleCopyReferralLink = async (link: string) => {
    await navigator.clipboard.writeText(link);
    haptics.success();
  };

  if (dashboardQuery.isLoading) {
    return (
      <div className="editorial-page px-4 py-5">
        <div className="animate-pulse space-y-4">
          <div className="h-48 rounded-3xl bg-gray-200" />
          <div className="h-32 rounded-2xl bg-gray-200" />
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-16 rounded-2xl bg-gray-200" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <div className="editorial-page px-4 py-5">
        <div className="rounded-2xl border border-negative/20 bg-negative/5 p-5 text-sm text-negative">
          {dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : t("errors.generic")}
        </div>
      </div>
    );
  }

  const referralLink = `t.me/hyperliq?ref=${username || walletAddress?.slice(0, 8)}`;
  const progressToNext = Math.max(0, 5000 - (dashboard.season.xpTotal % 5000));

  return (
    <div className="editorial-page">
      <div className="editorial-shell">
        <div>
          <p className="editorial-kicker">{t("nav.rewards")}</p>
          <h1 className="editorial-heading text-foreground">{t("nav.rewards")}</h1>
        </div>

        <div className="mt-5 rounded-[30px] bg-[#10161f] p-5 text-white shadow-[0_22px_50px_rgba(15,23,42,0.22)]">
          <div className="editorial-kicker text-white/55">
            {dashboard.season.name} · YOUR POINTS
          </div>
          <div className="editorial-mono mt-3 text-[3.25rem] font-semibold leading-none tracking-[-0.06em]">
            {formatCompactNumber(dashboard.season.xpTotal)}
          </div>
          <div className="mt-2 text-sm text-white/70">
            +{formatCompactNumber(dashboard.season.volumeXpTotal)} this week · rank #{dashboard.season.leaderboardRank ?? "—"}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] text-white/55">
              <span>TIER {Math.floor(dashboard.season.xpTotal / 5000)} · WAVE RIDER</span>
              <span>{progressToNext} TO NEXT</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(dashboard.season.xpTotal % 5000) / 50}%` }}
              />
            </div>
          </div>
        </div>

        <div className="editorial-card mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="editorial-section-title text-[1.45rem]">{t("points.referEarn")}</div>
              <div className="mt-1 text-sm text-muted">20% of friends&apos; fees forever</div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyReferralLink(referralLink)}
              className="editorial-button-primary px-4 py-2"
            >
              {t("common.share")}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="editorial-mono flex-1 truncate rounded-[18px] bg-[var(--color-primary-soft)] px-3 py-2.5 text-sm text-muted">
              {referralLink}
            </div>
            <button
              type="button"
              onClick={() => handleCopyReferralLink(referralLink)}
              className="editorial-button-secondary px-3 py-2.5"
            >
              {t("common.copy")}
            </button>
          </div>
        </div>

        <div className="pb-2 pt-6">
          <div className="editorial-kicker">{t("points.thisWeek")}</div>
        </div>
        <div className="space-y-3">
          <div className="editorial-card flex items-center justify-between px-4 py-4">
            <div>
              <div className="editorial-section-title text-[1.4rem]">{t("points.tradingVolume")}</div>
              <div className="mt-1 text-sm text-muted">{formatUsd(dashboard.season.eligibleVolume)}</div>
            </div>
            <div className="editorial-mono text-lg font-semibold text-positive">
              +{formatCompactNumber(dashboard.season.volumeXpTotal)}
            </div>
          </div>
          <div className="editorial-card flex items-center justify-between px-4 py-4">
            <div>
              <div className="editorial-section-title text-[1.4rem]">{t("points.daysActive")}</div>
              <div className="mt-1 text-sm text-muted">{dashboard.weeklyRaffle.userRank ? `${dashboard.weeklyRaffle.userRank} of 7` : "—"}</div>
            </div>
            <div className="editorial-mono text-lg font-semibold text-positive">
              +{formatCompactNumber(dashboard.season.questXpTotal)}
            </div>
          </div>
          <div className="editorial-card flex items-center justify-between px-4 py-4">
            <div>
              <div className="editorial-section-title text-[1.4rem]">{t("points.friendsJoined")}</div>
              <div className="mt-1 text-sm text-muted">{dashboard.referral.fundedReferralCount}</div>
            </div>
            <div className="editorial-mono text-lg font-semibold text-positive">
              +{formatCompactNumber(dashboard.referral.fundedReferralCount * 100)}
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
                <div key={entry.userId} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-sm font-bold text-foreground">
                      #{entry.rank}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{entry.displayName}</div>
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

        {user?.id && accessTokenQuery.data && (
          <div className="pt-6">
            <ReferralCard
              accessToken={accessTokenQuery.data}
              onApplied={handleReferralApplied}
              referral={dashboard.referral}
            />
          </div>
        )}
      </div>
    </div>
  );
}
