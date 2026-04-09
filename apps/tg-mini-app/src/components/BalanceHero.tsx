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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
    <section className="border-b border-separator bg-white">
      <div className="px-4 pb-5 pt-5">
        <div className="flex items-start justify-between gap-4 animate-pulse">
          <div className="min-w-0 flex-1">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="mt-3 h-10 w-40 rounded bg-gray-200" />
            <div className="mt-3 h-4 w-36 rounded bg-gray-100" />
          </div>
          <div className="h-11 w-[108px] rounded-full bg-gray-200" />
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

  return (
    <section className="border-b border-separator bg-white">
      <div className="px-4 pb-5 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">
              {t("balanceHero.totalEquity")}
            </p>
            {valueState.state === "ready" ? (
              <>
                <p className="mt-2 text-4xl font-bold tracking-tight text-foreground">
                  {formatUsd(valueState.totalValue ?? 0)}
                </p>
                <p className="mt-3 text-sm text-gray-400">
                  {t("balanceHero.availableForTrading", {
                    amount: formatUsd(valueState.availableValue ?? 0),
                  })}
                </p>
              </>
            ) : valueState.state === "loading" ? (
              <>
                <div className="mt-2 h-10 w-40 animate-pulse rounded bg-gray-200" />
                <div className="mt-3 h-4 w-40 animate-pulse rounded bg-gray-100" />
              </>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-400">
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
          </div>
          <button
            type="button"
            onClick={() => navigate("/account/deposit")}
            className="flex-shrink-0 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark"
          >
            {t("balanceHero.deposit")}
          </button>
        </div>

        <div className={`mt-5 ${HERO_CHART_SLOT_CLASS}`}>
          {showDeferredChart ? (
            <Suspense fallback={<BalanceHeroChartFallback />}>
              <BalanceHeroChart />
            </Suspense>
          ) : (
            <BalanceHeroChartFallback />
          )}
        </div>
        {userState?.shouldPromptRestoreUnified ? <UnifiedAccountBanner /> : null}
      </div>
    </section>
  );
}
