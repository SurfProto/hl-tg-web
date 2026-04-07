import { type ComponentType, Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserState } from "@repo/hyperliquid-sdk";
import { useTranslation } from "react-i18next";

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
  const { data: userState, isLoading: userStateLoading } = useUserState();

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

  const totalValue = userState?.marginSummary?.accountValue ?? 0;
  const availableValue = userState?.withdrawable ?? 0;

  if (userStateLoading) {
    return <BalanceHeroSkeleton />;
  }

  return (
    <section className="border-b border-separator bg-white">
      <div className="px-4 pb-5 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">
              {t("balanceHero.totalEquity")}
            </p>
            <p className="mt-2 text-4xl font-bold tracking-tight text-foreground">
              {formatUsd(totalValue)}
            </p>
            <p className="mt-3 text-sm text-gray-400">
              {t("balanceHero.availableForTrading", {
                amount: formatUsd(availableValue),
              })}
            </p>
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

      </div>
    </section>
  );
}
