import { useQuery } from "@tanstack/react-query";
import { usePrivy, useToken } from "@privy-io/react-auth";
import type { QuestProgress, RewardLedgerEntry } from "@repo/types";
import { useTranslation } from "react-i18next";
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

function formatDate(value: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function getQuestBadgeClass(status: QuestProgress["status"]) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "locked") {
    return "bg-slate-200 text-slate-500";
  }

  return "bg-blue-100 text-blue-700";
}

function getRewardValue(entry: RewardLedgerEntry) {
  if (entry.rewardKind === "usdc" || entry.rewardKind === "raffle") {
    return formatUsd(entry.amount);
  }

  if (entry.rewardKind === "tickets") {
    return `${formatCompactNumber(entry.amount)} tickets`;
  }

  return `${formatCompactNumber(entry.amount)} XP`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function PointsPage() {
  const { t } = useTranslation();
  const { user } = usePrivy();
  const { getAccessToken } = useToken();
  const telegramProfile = getTelegramProfile();
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null;
  const username =
    telegramProfile?.username ??
    user?.telegram?.username ??
    user?.email?.address ??
    null;
  const walletAddress = user?.wallet?.address ?? null;

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

  if (dashboardQuery.isLoading) {
    return (
      <div className="min-h-full bg-background px-4 py-5">
        <div className="animate-pulse space-y-4">
          <div className="h-40 rounded-3xl bg-slate-200" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-24 rounded-2xl bg-slate-200" />
            ))}
          </div>
          <div className="h-64 rounded-3xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <div className="min-h-full bg-background px-4 py-5">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">
          {dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : t("errors.generic")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <div className="rounded-3xl bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_100%)] px-5 py-6 text-white shadow-sm">
        <p className="text-xs uppercase tracking-[0.24em] text-blue-100">
          {dashboard.season.name}
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-4xl font-bold">
              {formatCompactNumber(dashboard.season.xpTotal)} XP
            </p>
            <p className="mt-2 text-sm text-blue-100">
              {formatUsd(dashboard.season.eligibleVolume)} app volume this season
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 text-right backdrop-blur">
            <p className="text-xs uppercase tracking-[0.18em] text-blue-100">
              Rank
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {dashboard.season.leaderboardRank ? `#${dashboard.season.leaderboardRank}` : "—"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-2xl bg-white/10 px-3 py-3 backdrop-blur">
            <p className="text-blue-100">Quest XP</p>
            <p className="mt-1 font-semibold">{formatCompactNumber(dashboard.season.questXpTotal)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-3 backdrop-blur">
            <p className="text-blue-100">Trade XP</p>
            <p className="mt-1 font-semibold">{formatCompactNumber(dashboard.season.volumeXpTotal)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-3 backdrop-blur">
            <p className="text-blue-100">Weekly cutoff</p>
            <p className="mt-1 font-semibold">{formatUsd(dashboard.weeklyRaffle.cutoffVolume)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ["Volume XP", `${formatCompactNumber(dashboard.season.volumeXpTotal)} XP`],
          ["Funded referrals", String(dashboard.referral.fundedReferralCount)],
          [
            "Weekly rank",
            dashboard.weeklyRaffle.userRank ? `#${dashboard.weeklyRaffle.userRank}` : "—",
          ],
          [
            "Raffle status",
            dashboard.weeklyRaffle.userIsEligible ? "Eligible" : formatUsd(dashboard.weeklyRaffle.userDistanceToCutoff),
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Funding quests</p>
            <p className="mt-1 text-sm text-muted">
              Four launch quests that push funding, trading, and high-quality referrals.
            </p>
          </div>
          <button
            className="rounded-full border border-separator px-4 py-2 text-sm font-semibold text-foreground"
            onClick={() => void dashboardQuery.refetch()}
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {dashboard.quests.map((quest) => (
            <div key={quest.id} className="rounded-2xl bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{quest.title}</p>
                  <p className="mt-1 text-sm text-muted">{quest.description}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getQuestBadgeClass(quest.status)}`}>
                  {quest.status.replace("_", " ")}
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{
                    width: `${Math.min(
                      100,
                      (quest.progressCurrent / Math.max(quest.progressTarget, 1)) * 100,
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
                <p>
                  {quest.progressCurrent}/{quest.progressTarget} complete
                </p>
                <p>{quest.completedAt ? `Done ${formatDate(quest.completedAt)}` : "Pending"}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {quest.rewards.map((reward) => (
                  <span
                    key={`${quest.id}-${reward.kind}`}
                    className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-foreground"
                  >
                    {reward.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Referral challenge</p>
            <p className="mt-1 text-sm text-muted">
              Both sides unlock rewards after the invited trader completes a funded deposit.
            </p>
          </div>
          <button
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white"
            onClick={() => void copyText(dashboard.referral.referralCode)}
            type="button"
          >
            {t("common.share")}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <div>
            <p className="text-xs text-muted">Referral code</p>
            <p className="mt-1 font-mono text-sm font-semibold text-foreground">
              {dashboard.referral.referralCode}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Funded / total</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {dashboard.referral.fundedReferralCount}/{dashboard.referral.referredCount}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Top traders</p>
            <p className="mt-1 text-sm text-muted">
              Ranked by eligible app-attributed volume, not PnL.
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Weekly raffle top {dashboard.weeklyRaffle.cohortSize}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {dashboard.leaderboard.entries.map((entry) => (
            <div key={entry.userId} className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-foreground">
                  #{entry.rank}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{entry.displayName}</p>
                  <p className="text-xs text-muted">{formatCompactNumber(entry.xp)} XP</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground">{formatUsd(entry.eligibleVolume)}</p>
                <p className="text-xs text-muted">
                  {entry.raffleEligible ? "Raffle eligible" : "Season volume"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Weekly raffle</p>
            <p className="mt-1 text-sm text-muted">
              Top-volume traders enter the weekly draw. Winners are picked from the current top cohort.
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-foreground">
              {dashboard.weeklyRaffle.userIsEligible ? "You are in" : "Chasing cutoff"}
            </p>
            <p className="text-muted">
              {dashboard.weeklyRaffle.userIsEligible
                ? `Rank #${dashboard.weeklyRaffle.userRank ?? "—"}`
                : `${formatUsd(dashboard.weeklyRaffle.userDistanceToCutoff)} to qualify`}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface p-4">
            <p className="text-xs text-muted">Window</p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {formatDate(dashboard.weeklyRaffle.weekStart)} → {formatDate(dashboard.weeklyRaffle.weekEnd)}
            </p>
          </div>
          <div className="rounded-2xl bg-surface p-4">
            <p className="text-xs text-muted">Cutoff volume</p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {formatUsd(dashboard.weeklyRaffle.cutoffVolume)}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {dashboard.weeklyRaffle.winners.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-separator p-4 text-sm text-muted">
              Winners will appear here after the raffle draw runs.
            </div>
          ) : (
            dashboard.weeklyRaffle.winners.map((winner) => (
              <div key={winner.userId} className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{winner.displayName}</p>
                <p className="text-sm font-semibold text-foreground">{formatUsd(winner.prizeUsdc)}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-separator bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Reward history</p>
        <div className="mt-4 space-y-2">
          {dashboard.rewardHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-separator p-4 text-sm text-muted">
              Your rewards will appear after the first funded event or app-attributed trade.
            </div>
          ) : (
            dashboard.rewardHistory.slice(0, 12).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{entry.description}</p>
                  <p className="mt-1 text-xs text-muted">
                    {entry.source.replace(/_/g, " ")} · {formatDate(entry.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-foreground">{getRewardValue(entry)}</p>
                  <p className="mt-1 text-xs text-muted">{entry.status}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
