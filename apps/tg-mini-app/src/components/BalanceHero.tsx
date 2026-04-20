import { type ComponentType, Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserState } from "@repo/hyperliquid-sdk";
import { useTranslation } from "react-i18next";
import { UnifiedAccountBanner } from "./UnifiedAccountBanner";
import { getBalanceHeroValueState } from "./balance-hero-state";

function lazyNamedModule<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType<any> };
  });
}

const BalanceHeroChart = lazyNamedModule(
  () => import("./BalanceHeroChart"),
  "BalanceHeroChart",
);
const HERO_CHART_SLOT_CLASS = "min-h-[286px]";

function formatUsd(value: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return formatted;
}

function formatUsdParts(value: number): { integer: string; decimal: string } {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  const parts = formatted.split(".");
  return {
    integer: parts[0] || "0",
    decimal: parts[1] || "00",
  };
}

function BalanceHeroChartFallback() {
  return (
    <div className="animate-pulse">
      <div className="h-5 w-28 rounded bg-gray-200" />
      <div className="mt-4 h-[252px] rounded-[32px] bg-gray-100" />
    </div>
  );
}

export function BalanceHeroSkeleton() {
  return (
    <section className="bg-white">
      <div className="px-4 pb-5 pt-5">
        <div className="animate-pulse">
          <div className="h-3 w-20 rounded bg-gray-200" />
          <div className="mt-3 h-12 w-48 rounded bg-gray-200" />
          <div className="mt-3 h-4 w-36 rounded bg-gray-100" />
        </div>

        <div className={`mt-5 ${HERO_CHART_SLOT_CLASS}`}>
          <BalanceHeroChartFallback />
        </div>
      </div>
    </section>
  );
}

export function BalanceHero() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [showDeferredChart, setShowDeferredChart] = useState(false);
  const {
    data: userState,
    isError: userStateError,
    isLoading: userStateLoading,
    refetch: refetchUserState,
  } = useUserState();

  useEffect(() => {
    const showChart = () => setShowDeferredChart(true);
    const requestIdleCallback = window.requestIdleCallback?.bind(window);
    const cancelIdleCallback = window.cancelIdleCallback?.bind(window);

    if (requestIdleCallback && cancelIdleCallback) {
      const idleId = requestIdleCallback(showChart, { timeout: 600 });
      return () => cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(showChart, 160);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const valueState = getBalanceHeroValueState({
    userState,
    isLoading: userStateLoading,
    isError: userStateError,
  });

  const totalValueParts = formatUsdParts(valueState.state === "ready" ? (valueState.totalValue ?? 0) : 0);
  const dailyChange = valueState.state === "ready" ? (valueState.dailyChange ?? 0) : 0;
  const dailyChangePercent = valueState.state === "ready" ? (valueState.dailyChangePercent ?? 0) : 0;
  const isPositive = dailyChange >= 0;

  return (
    <section className="bg-white">
      <div className="px-4 pb-5 pt-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
          {t("balanceHero.totalEquity")}
        </p>
        
        {valueState.state === "ready" ? (
          <>
            <p className="mt-2 flex items-baseline gap-0.5">
              <span className="text-[2.75rem] font-bold tracking-tight text-foreground font-mono">
                ${totalValueParts.integer}
              </span>
              <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
                .{totalValueParts.decimal}
              </span>
            </p>
            <p className={`mt-2 text-sm font-medium ${isPositive ? 'text-positive' : 'text-negative'}`}>
              <span className="font-mono">
                {isPositive ? '+' : ''}{formatUsd(dailyChange)}
              </span>
              <span className="ml-1">
                {isPositive ? '+' : ''}{dailyChangePercent.toFixed(2)}% {t("balanceHero.today")}
              </span>
            </p>
          </>
        ) : valueState.state === "loading" ? (
          <>
            <div className="mt-2 h-12 w-48 animate-pulse rounded bg-gray-200" />
            <div className="mt-3 h-4 w-40 animate-pulse rounded bg-gray-100" />
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>{t("balanceHero.balanceUnavailable")}</span>
            <button
              type="button"
              onClick={() => void refetchUserState()}
              className="font-semibold text-primary transition-colors active:text-primary-dark"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        <div className={`mt-5 ${HERO_CHART_SLOT_CLASS}`}>
          {showDeferredChart ? (
            <Suspense fallback={<BalanceHeroChartFallback />}>
              <BalanceHeroChart />
            </Suspense>
          ) : (
            <BalanceHeroChartFallback />
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => navigate("/account/deposit")}
            className="flex-1 rounded-full bg-secondary py-3.5 text-sm font-semibold text-white transition-opacity active:opacity-80"
          >
            {t("account.deposit")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/account/withdraw")}
            className="flex-1 rounded-full border border-separator bg-white py-3.5 text-sm font-semibold text-foreground transition-colors active:bg-gray-50"
          >
            {t("account.withdraw")}
          </button>
        </div>

        {userState?.shouldPromptRestoreUnified ? <UnifiedAccountBanner /> : null}
      </div>
    </section>
  );
}
