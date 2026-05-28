import { useMemo } from 'react';
import { usePortfolioPeriod } from '@repo/hyperliquid-sdk';
import { useTranslation } from 'react-i18next';
import { usePortfolioRange } from '../hooks/usePortfolioRange';
import { getPortfolioChangePct, getPortfolioTone } from '../lib/portfolio';

export function BalanceHeroChart() {
  const { t } = useTranslation();
  const { period, setPeriod } = usePortfolioRange();
  const { data: portfolioPeriod, isError, isLoading } = usePortfolioPeriod(period);
  const historyPoints = portfolioPeriod?.accountValueHistory ?? [];

  const performance = useMemo(() => {
    const changePct = getPortfolioChangePct(historyPoints);
    return { changePct, tone: getPortfolioTone(historyPoints) };
  }, [historyPoints]);
  const sparklinePath = useMemo(() => {
    if (historyPoints.length === 0) return '';
    const values = historyPoints.map((point) => point.value);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || 1;
    return historyPoints
      .map((point, index) => {
        const x = historyPoints.length === 1 ? 0 : (index / (historyPoints.length - 1)) * 100;
        const y = 38 - ((point.value - low) / span) * 34;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }, [historyPoints]);

  const periodCopy =
    period === '1d'
      ? t('chart.pastDay')
      : period === '7d'
        ? t('chart.pastWeek')
        : t('chart.pastMonth');

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 w-28 rounded bg-gray-200" />
        <div className="mt-4 h-[72px] rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <div className="text-sm font-semibold text-gray-500">0.00%</div>
        <div className="mt-4 flex h-[72px] items-center justify-center rounded-xl border border-dashed border-separator bg-surface">
          <p className="text-sm text-gray-400">{t('chart.unavailable')}</p>
        </div>
      </div>
    );
  }

  if (historyPoints.length === 0) {
    return (
      <div>
        <div className="text-sm font-semibold text-gray-500">0.00%</div>
        <div className="mt-4 flex h-[72px] items-center justify-center rounded-xl border border-dashed border-separator bg-surface">
          <p className="text-sm text-gray-400">{t('chart.empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
          performance.tone === 'positive'
            ? 'p34k-signal'
            : performance.tone === 'negative'
              ? 'bg-negative/10 text-negative'
              : 'bg-surface text-gray-500'
        }`}
      >
        {performance.changePct > 0 ? '+' : ''}
        {performance.changePct.toFixed(2)}%
        <span className="ml-1 font-medium opacity-65">{periodCopy}</span>
      </div>

      <svg className="mt-4 h-[58px] w-full overflow-visible" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
        <path d={sparklinePath} fill="none" stroke="var(--color-primary)" strokeWidth="1.65" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-3 flex gap-1.5">
        {[
          { key: '1d' as const, label: '1D' },
          { key: '7d' as const, label: '1W' },
          { key: '30d' as const, label: '1M' },
        ].map((range) => (
          <button
            key={range.key}
            type="button"
            onClick={() => setPeriod(range.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              period === range.key ? 'bg-primary text-white' : 'bg-surface text-muted'
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
