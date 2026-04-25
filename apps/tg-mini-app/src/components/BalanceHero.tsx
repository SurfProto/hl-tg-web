import { type ComponentType, Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserState } from "@repo/hyperliquid-sdk";
import { useTranslation } from "react-i18next";
import { UnifiedAccountBanner } from "./UnifiedAccountBanner";
import {
  getBalanceHeroDisplayState,
  getBalanceHeroValueState,
} from "./balance-hero-state";

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
    <section className="px-4 pt-5">
      <div className="editorial-card overflow-hidden px-5 pb-5 pt-5">
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
  const displayState = getBalanceHeroDisplayState(valueState);

  const totalValueParts = formatUsdParts(
    valueState.state === "ready" ? displayState.highlightValue : 0,
  );

  return (
    <section className="px-4 pt-5">
      <div className="editorial-card overflow-hidden px-5 pb-5 pt-5">
        <p className="editorial-kicker">
          {t("balanceHero.totalEquity")}
        </p>
        
        {valueState.state === "ready" ? (
          <>
            <p className="mt-2 flex items-baseline gap-0.5">
              <span className="editorial-mono text-[2.95rem] font-semibold tracking-[-0.06em] text-foreground">
                ${totalValueParts.integer}
              </span>
              <span className="editorial-mono text-[2rem] font-semibold tracking-[-0.05em] text-foreground">
                .{totalValueParts.decimal}
              </span>
            </p>
            <p className="mt-2 max-w-[14rem] text-sm text-[var(--color-text-secondary)]">
              {t("balanceHero.availableForTrading", {
                amount: formatUsd(displayState.availableValue),
              })}
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
            className="editorial-button-primary flex-1"
          >
            {t("account.deposit")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/account/withdraw")}
            className="editorial-button-secondary flex-1"
          >
            {t("account.withdraw")}
          </button>
        </div>

        {userState?.shouldPromptRestoreUnified ? <UnifiedAccountBanner /> : null}
      </div>
    </section>
  );
}
