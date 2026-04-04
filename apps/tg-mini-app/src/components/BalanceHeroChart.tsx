import { useMemo } from 'react';
import { usePortfolioPeriod } from '@repo/hyperliquid-sdk';
import { Chart } from '@repo/ui';
import { usePortfolioRange } from '../hooks/usePortfolioRange';
import { getPortfolioChangePct, getPortfolioTone } from '../lib/portfolio';

export function BalanceHeroChart() {
  const { period, setPeriod } = usePortfolioRange();
  const { data: portfolioPeriod, isError, isLoading } = usePortfolioPeriod(period);
  const historyPoints = portfolioPeriod?.accountValueHistory ?? [];

  const performance = useMemo(() => {
    const changePct = getPortfolioChangePct(historyPoints);
    return { changePct, tone: getPortfolioTone(historyPoints) };
  }, [historyPoints]);

  const periodCopy =
    period === '1d' ? 'past day' : period === '7d' ? 'past week' : 'past month';

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 w-28 rounded bg-gray-200" />
        <div className="mt-4 h-[228px] rounded-[28px] bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <div className="text-sm font-semibold text-gray-500">0.00%</div>
        <div className="mt-4 flex h-[228px] items-center justify-center rounded-[28px] border border-dashed border-separator bg-surface">
          <p className="text-sm text-gray-400">Portfolio history is temporarily unavailable.</p>
        </div>
      </div>
    );
  }

  if (historyPoints.length === 0) {
    return (
      <div>
        <div className="text-sm font-semibold text-gray-500">0.00%</div>
        <div className="mt-4 flex h-[228px] items-center justify-center rounded-[28px] border border-dashed border-separator bg-surface">
          <p className="text-sm text-gray-400">Portfolio history will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={`text-sm font-semibold ${
          performance.tone === 'positive'
            ? 'text-positive'
            : performance.tone === 'negative'
              ? 'text-negative'
              : 'text-gray-500'
        }`}
      >
        {performance.changePct > 0 ? '+' : ''}
        {performance.changePct.toFixed(2)}%
        <span className="ml-1 font-medium text-gray-400">{periodCopy}</span>
      </div>

      <div className="mt-4">
        <Chart
          candles={[]}
          interval={period}
          onIntervalChange={(value) => setPeriod(value as typeof period)}
          mode="area"
          variant="lite-area"
          tone={performance.tone}
          areaData={historyPoints}
          ranges={[
            { key: '1d', label: '1D' },
            { key: '7d', label: '1W' },
            { key: '30d', label: '1M' },
          ]}
          showGrid={false}
          showFooterStats={false}
          heightClassName="h-[228px]"
        />
      </div>
    </div>
  );
}
