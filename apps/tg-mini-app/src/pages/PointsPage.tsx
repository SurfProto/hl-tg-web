import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy, useToken } from "@privy-io/react-auth";
import type { QuestProgress, ReferralSummary, RewardLedgerEntry, RewardsDashboard } from "@repo/types";
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
      <div className="min-h-full bg-background px-4 py-5">
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
      <div className="min-h-full bg-background px-4 py-5">
        <div className="rounded-2xl border border-negative/20 bg-negative/5 p-5 text-sm text-negative">
          {dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : t("errors.generic")}
        </div>
      </div>
    );
  }

  const referralLink = `t.me/hyperliq?ref=${username || walletAddress?.slice(0, 8)}`;

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="px-4 pt-5 pb-4 bg-white">
        <h1 className="text-2xl font-bold text-foreground">{t("nav.rewards")}</h1>
      </div>

      {/* Points Hero Card */}
      <div className="px-4 py-4">
        <div className="rounded-3xl bg-secondary p-5 text-white">
          <div className="text-xs uppercase tracking-[0.2em] text-white/60">
            {dashboard.season.name} · YOUR POINTS
          </div>
          <div className="mt-3 text-5xl font-bold font-mono tracking-tight">
            {formatCompactNumber(dashboard.season.xpTotal)}
          </div>
          <div className="mt-2 text-sm text-white/70">
            +{formatCompactNumber(dashboard.season.volumeXpTotal)} this week · rank #{dashboard.season.leaderboardRank ?? "—"}
          </div>
          
          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/60">TIER {Math.floor(dashboard.season.xpTotal / 5000)} - WAVE RIDER</span>
              <span className="text-white/60">{5000 - (dashboard.season.xpTotal % 5000)} TO NEXT</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(dashboard.season.xpTotal % 5000) / 50}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Referral Section */}
      <div className="px-4 py-2">
        <div className="rounded-2xl border border-separator bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold text-foreground">{t("points.referEarn")}</div>
              <div className="text-sm text-muted mt-0.5">20% of friends&apos; fees forever</div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyReferralLink(referralLink)}
              className="px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold transition-opacity active:opacity-80"
            >
              {t("common.share")}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 px-3 py-2.5 rounded-lg bg-surface text-sm text-muted font-mono truncate">
              {referralLink}
            </div>
            <button
              type="button"
              onClick={() => handleCopyReferralLink(referralLink)}
              className="px-3 py-2.5 rounded-lg bg-surface text-sm font-semibold text-foreground transition-colors active:bg-gray-200"
            >
              {t("common.copy")}
            </button>
          </div>
        </div>
      </div>

      {/* This Week Stats */}
      <div className="px-4 pt-4 pb-2">
        <div className="text-xs font-semibold text-muted uppercase tracking-wide">
          {t("points.thisWeek")}
        </div>
      </div>
      <div className="px-4 space-y-2">
        <div className="flex items-center justify-between py-3 px-4 rounded-2xl border border-separator bg-white">
          <div>
            <div className="text-base text-foreground">{t("points.tradingVolume")}</div>
            <div className="text-sm text-muted">{formatUsd(dashboard.season.eligibleVolume)}</div>
          </div>
          <div className="text-positive font-semibold font-mono">
            +{formatCompactNumber(dashboard.season.volumeXpTotal)}
          </div>
        </div>
        <div className="flex items-center justify-between py-3 px-4 rounded-2xl border border-separator bg-white">
          <div>
            <div className="text-base text-foreground">{t("points.daysActive")}</div>
            <div className="text-sm text-muted">{dashboard.weeklyRaffle.userRank ? `${dashboard.weeklyRaffle.userRank} of 7` : "—"}</div>
          </div>
          <div className="text-positive font-semibold font-mono">
            +{formatCompactNumber(dashboard.season.questXpTotal)}
          </div>
        </div>
        <div className="flex items-center justify-between py-3 px-4 rounded-2xl border border-separator bg-white">
          <div>
            <div className="text-base text-foreground">{t("points.friendsJoined")}</div>
            <div className="text-sm text-muted">{dashboard.referral.fundedReferralCount}</div>
          </div>
          <div className="text-positive font-semibold font-mono">
            +{formatCompactNumber(dashboard.referral.fundedReferralCount * 100)}
          </div>
        </div>
      </div>

      {/* Quests Section */}
      {dashboard.quests.length > 0 && (
        <>
          <div className="px-4 pt-6 pb-2">
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">
              {t("points.quests")}
            </div>
          </div>
          <div className="px-4 space-y-2 pb-6">
            {dashboard.quests.map((quest) => (
              <div key={quest.id} className="rounded-2xl border border-separator bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-foreground">{quest.title}</span>
                      {quest.status === "completed" && (
                        <span className="px-2 py-0.5 rounded-full bg-positive/10 text-positive text-xs font-semibold">
                          {t("common.done")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted mt-1">{quest.description}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-foreground">
                      {quest.rewards[0]?.label ?? "—"}
                    </div>
                  </div>
                </div>
                
                {/* Progress */}
                <div className="mt-3">
                  <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (quest.progressCurrent / Math.max(quest.progressTarget, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs text-muted">
                    <span>{quest.progressCurrent}/{quest.progressTarget}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Leaderboard Preview */}
      {dashboard.leaderboard.entries.length > 0 && (
        <>
          <div className="px-4 pt-2 pb-2">
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">
              {t("points.topTraders")}
            </div>
          </div>
          <div className="px-4 pb-6">
            <div className="rounded-2xl border border-separator bg-white divide-y divide-separator">
              {dashboard.leaderboard.entries.slice(0, 5).map((entry) => (
                <div key={entry.userId} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-sm font-bold text-foreground">
                      #{entry.rank}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{entry.displayName}</div>
                      <div className="text-xs text-muted font-mono">{formatCompactNumber(entry.xp)} XP</div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-foreground font-mono">
                    {formatUsd(entry.eligibleVolume)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Referral Card (existing component) */}
      {user?.id && accessTokenQuery.data && (
        <div className="px-4 pb-6">
          <ReferralCard
            accessToken={accessTokenQuery.data}
            onApplied={handleReferralApplied}
            referral={dashboard.referral}
          />
        </div>
      )}
    </div>
  );
}
