import { type ComponentType, Suspense, lazy, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserState } from '@repo/hyperliquid-sdk';

function lazyNamedModule<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType<any> };
  });
}

const BalanceHeroChart = lazyNamedModule(() => import('./BalanceHeroChart'), 'BalanceHeroChart');

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function BalanceBreakdown({
  label,
  total,
  available,
}: {
  label: string;
  total: number;
  available: number;
}) {
  const locked = total - available > 0.005;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      <span className="text-xs text-gray-700 font-semibold">{formatUsd(total)}</span>
      {locked && (
        <span className="text-xs text-gray-400">{formatUsd(available)} avail</span>
      )}
    </div>
  );
}

function BalanceHeroChartFallback() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-28 rounded bg-gray-200" />
      <div className="mt-4 h-[228px] rounded-[28px] bg-gray-100" />
    </div>
  );
}

export function BalanceHeroSkeleton() {
  return (
    <section className="border-b border-separator bg-white animate-pulse">
      <div className="px-4 pt-5 pb-5">
        <div className="h-3 w-20 rounded bg-gray-200" />
        <div className="mt-3 h-10 w-40 rounded bg-gray-200" />

        <div className="mt-4 flex gap-5">
          <div className="space-y-2">
            <div className="h-3 w-10 rounded bg-gray-200" />
            <div className="h-3 w-20 rounded bg-gray-100" />
            <div className="h-3 w-14 rounded bg-gray-100" />
          </div>
        </div>

        <div className="mt-5 min-h-[276px]">
          <BalanceHeroChartFallback />
        </div>

        <div className="mt-5 flex gap-3">
          <div className="h-12 flex-1 rounded-full bg-gray-200" />
          <div className="h-12 flex-1 rounded-full bg-gray-100" />
        </div>
      </div>
    </section>
  );
}

export function BalanceHero() {
  const navigate = useNavigate();
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

  const perpsValue = userState?.marginSummary?.accountValue ?? 0;
  const perpsAvailable = userState?.withdrawable ?? 0;
  const totalValue = perpsValue;
  const shellLoading = userStateLoading;

  if (shellLoading) {
    return <BalanceHeroSkeleton />;
  }

  return (
    <section className="border-b border-separator bg-white">
      <div className="px-4 pt-5 pb-5">
        <div className="mb-1">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            Total Equity
          </p>
          <p className="text-4xl font-bold text-foreground tracking-tight">
            {formatUsd(totalValue)}
          </p>
        </div>

        <div className="mt-4 flex gap-5">
          <BalanceBreakdown
            label="Perps"
            total={perpsValue}
            available={perpsAvailable}
          />
        </div>

        <div className="mt-5 min-h-[276px]">
          {showDeferredChart ? (
            <Suspense fallback={<BalanceHeroChartFallback />}>
              <BalanceHeroChart />
            </Suspense>
          ) : (
            <BalanceHeroChartFallback />
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/account/deposit')}
            className="flex-1 py-3 rounded-full bg-primary text-white text-sm font-semibold active:bg-primary-dark transition-colors"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() => navigate('/account/withdraw')}
            className="flex-1 py-3 rounded-full bg-gray-100 text-foreground text-sm font-semibold active:bg-gray-200 transition-colors"
          >
            Withdraw
          </button>
        </div>
      </div>
    </section>
  );
}
