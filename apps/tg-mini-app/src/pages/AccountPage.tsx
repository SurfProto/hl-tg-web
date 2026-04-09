import { type ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { usePortfolioPeriod, useUserState } from "@repo/hyperliquid-sdk";
import type { PortfolioRange } from "@repo/types";
import { useTranslation } from "react-i18next";
import { useHaptics } from "../hooks/useHaptics";
import { usePortfolioRange } from "../hooks/usePortfolioRange";
import {
  getPortfolioMaxDrawdownPct,
  getPortfolioRangePnl,
} from "../lib/portfolio";
import { StableBalanceList } from "../components/StableBalanceList";
import { UnifiedAccountBanner } from "../components/UnifiedAccountBanner";

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatSignedUsd(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatDrawdownPercent(value: number) {
  return value > 0 ? `-${value.toFixed(2)}%` : "0.00%";
}

function SettingsIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M10.5 3.75c.692-1.2 2.424-1.2 3.116 0l.24.415a1.8 1.8 0 001.944.852l.47-.102c1.358-.295 2.583.93 2.288 2.288l-.102.47a1.8 1.8 0 00.852 1.944l.415.24c1.2.692 1.2 2.424 0 3.116l-.415.24a1.8 1.8 0 00-.852 1.944l.102.47c.295 1.358-.93 2.583-2.288 2.288l-.47-.102a1.8 1.8 0 00-1.944.852l-.24.415c-.692 1.2-2.424 1.2-3.116 0l-.24-.415a1.8 1.8 0 00-1.944-.852l-.47.102c-1.358.295-2.583-.93-2.288-2.288l.102-.47a1.8 1.8 0 00-.852-1.944l-.415-.24c-1.2-.692-1.2-2.424 0-3.116l.415-.24a1.8 1.8 0 00.852-1.944l-.102-.47c-.295-1.358.93-2.583 2.288-2.288l.47.102a1.8 1.8 0 001.944-.852l.24-.415z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function SkeletonBar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

function Surface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-separator bg-white p-4 shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  helper,
  valueClassName = "text-foreground",
  loading = false,
}: {
  label: string;
  value: string;
  helper?: string;
  valueClassName?: string;
  loading?: boolean;
}) {
  return (
    <div className="min-h-[92px] rounded-2xl border border-separator bg-white p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      {loading ? (
        <>
          <SkeletonBar className="mt-3 h-6 w-20" />
          <SkeletonBar className="mt-2 h-3 w-14 bg-gray-100" />
        </>
      ) : (
        <>
          <p className={`mt-3 text-lg font-semibold ${valueClassName}`}>
            {value}
          </p>
          <p className="mt-1 text-xs text-muted">{helper}</p>
        </>
      )}
    </div>
  );
}

export function AccountPage() {
  const haptics = useHaptics();
  const { t } = useTranslation();
  const privy = usePrivy() as any;
  const { user } = privy;
  const { period, setPeriod } = usePortfolioRange();
  const { wallets } = useWallets();
  const { data: userState, isLoading: userStateLoading } = useUserState();
  const { data: portfolioPeriod, isLoading: portfolioLoading } =
    usePortfolioPeriod(period);

  const walletAddress =
    user?.wallet?.address ??
    wallets.find((wallet) => wallet.walletClientType === "privy")?.address;
  const telegramUsername = user?.telegram?.username ?? null;
  const displayName =
    telegramUsername ??
    user?.email?.address ??
    user?.wallet?.address ??
    t("account.traderFallback");

  const totalEquity = userState?.marginSummary?.accountValue ?? 0;
  const availableBalance = userState?.availableBalance ?? 0;
  const visibleStableBalances = userState?.visibleStableBalances ?? [];

  const rangePnl = useMemo(
    () => getPortfolioRangePnl(portfolioPeriod?.pnlHistory ?? []),
    [portfolioPeriod?.pnlHistory],
  );
  const maxDrawdown = useMemo(
    () =>
      getPortfolioMaxDrawdownPct(portfolioPeriod?.accountValueHistory ?? []),
    [portfolioPeriod?.accountValueHistory],
  );

  const metricRangeLabel =
    period === "1d" ? "1D" : period === "7d" ? "1W" : "1M";
  const pnlColorClass =
    rangePnl > 0
      ? "text-positive"
      : rangePnl < 0
        ? "text-negative"
        : "text-foreground";
  const drawdownColorClass =
    maxDrawdown > 0 ? "text-negative" : "text-foreground";
  const hasRangeHistory =
    (portfolioPeriod?.accountValueHistory?.length ?? 0) > 1 &&
    (portfolioPeriod?.pnlHistory?.length ?? 0) > 0;
  const portfolioMetricsLoading =
    portfolioLoading || !portfolioPeriod || !hasRangeHistory;
  const shellLoading = userStateLoading;
  const portfolioRanges: Array<{ key: PortfolioRange; label: string }> = [
    { key: "1d", label: "1D" },
    { key: "7d", label: "1W" },
    { key: "30d", label: "1M" },
  ];
  const actionLinks = [
    { label: t("account.deposit"), path: "/account/deposit" },
    { label: t("account.withdraw"), path: "/account/withdraw" },
    { label: t("account.swap"), path: "/account/swap" },
  ];

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <Surface className="rounded-[28px] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{t("account.sectionLabel")}</p>
            {shellLoading ? (
              <>
                <SkeletonBar className="mt-2 h-8 w-36" />
                <SkeletonBar className="mt-2 h-4 w-44 bg-gray-100" />
              </>
            ) : (
              <>
                <h1 className="mt-1 truncate text-[2rem] font-bold leading-none text-foreground">
                  {telegramUsername ? `@${displayName}` : displayName}
                </h1>
                <p className="mt-2 truncate text-sm text-muted">
                  {user?.email?.address ??
                    t("account.connectedInfo")}
                </p>
              </>
            )}
          </div>

          <Link
            to="/account/settings"
            onClick={() => haptics.light()}
            aria-label={t("account.openSettings")}
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-surface text-foreground transition-colors active:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <SettingsIcon />
          </Link>
        </div>
        {userState?.shouldPromptRestoreUnified ? <UnifiedAccountBanner /> : null}
      </Surface>

      <Surface>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("account.embeddedWallet")}
            </p>
            {shellLoading ? (
              <SkeletonBar className="mt-2 h-4 w-28" />
            ) : (
              <p className="mt-1 font-mono text-sm text-muted">
                {walletAddress ? formatAddress(walletAddress) : t("personalInfo.noWallet")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!walletAddress) return;
              await navigator.clipboard.writeText(walletAddress);
              haptics.success();
            }}
            className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground transition-colors active:bg-gray-100"
          >
            {t("common.copy")}
          </button>
        </div>
      </Surface>

      <Surface>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("account.portfolioMetrics")}
            </p>
            <p className="mt-1 text-xs text-muted">
              {t("account.syncedWithHome")}
            </p>
          </div>
          <div className="chart-range-pill inline-flex items-center gap-1 rounded-full px-1.5 py-1">
            {portfolioRanges.map((range) => {
              const active = period === range.key;

              return (
                <button
                  key={range.key}
                  type="button"
                  onClick={() => setPeriod(range.key)}
                  aria-pressed={active}
                  className={`min-w-[42px] rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${
                    active
                      ? "bg-white text-foreground shadow-sm"
                      : "text-gray-400"
                  }`}
                >
                  {range.label}
                </button>
              );
            })}
          </div>
        </div>
      </Surface>

      <StableBalanceList balances={visibleStableBalances} />

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label={t("account.totalEquity")}
          value={formatUsd(totalEquity)}
          helper={t("account.accountValue")}
          loading={shellLoading}
        />
        <MetricCard
          label={t("account.availableBalance")}
          value={formatUsd(availableBalance)}
          helper={t("account.readyToTrade")}
          loading={shellLoading}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label={t("account.profitLoss")}
          value={portfolioMetricsLoading ? "\u2014" : formatSignedUsd(rangePnl)}
          helper={`${metricRangeLabel} ${t("account.range")}`}
          valueClassName={
            portfolioMetricsLoading ? "text-foreground" : pnlColorClass
          }
          loading={portfolioMetricsLoading}
        />
        <MetricCard
          label={t("account.maxDrawdown")}
          value={
            portfolioMetricsLoading
              ? "\u2014"
              : formatDrawdownPercent(maxDrawdown)
          }
          helper={`${metricRangeLabel} ${t("account.range")}`}
          valueClassName={
            portfolioMetricsLoading ? "text-foreground" : drawdownColorClass
          }
          loading={portfolioMetricsLoading}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {actionLinks.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            onClick={() => haptics.light()}
            className="rounded-2xl border border-separator bg-white px-3 py-3 text-center text-sm font-semibold text-foreground shadow-sm transition-colors active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
