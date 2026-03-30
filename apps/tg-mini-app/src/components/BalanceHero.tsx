import { useNavigate } from 'react-router-dom';
import { useUserState, useSpotBalance, usePortfolioHistory } from '@repo/hyperliquid-sdk';
import { Chart } from '@repo/ui';
import { useState } from 'react';

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function BalanceHero() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<'1d' | '7d' | '30d'>('7d');
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const { data: portfolioHistory } = usePortfolioHistory(period);

  // Perps equity
  const perpsValue = userState?.marginSummary?.accountValue ?? 0;

  // Spot equity: sum all non-zero spot balances
  const spotValue = (() => {
    if (!spotBalance?.balances) return 0;
    return (spotBalance.balances as Array<{ coin: string; total: string; entryNtl: string }>)
      .reduce((sum, b) => sum + parseFloat(b.total ?? '0'), 0);
  })();

  const totalValue = perpsValue + spotValue;

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Total balance */}
      <div className="mb-1">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Total Balance</p>
        <p className="text-4xl font-bold text-foreground tracking-tight">
          {formatUsd(totalValue)}
        </p>
      </div>

      {/* Equity breakdown */}
      <div className="flex gap-4 mt-2 mb-5">
        <span className="text-xs text-gray-400">
          Perps <span className="text-gray-600 font-medium">{formatUsd(perpsValue)}</span>
        </span>
        <span className="text-xs text-gray-400">
          Spot <span className="text-gray-600 font-medium">{formatUsd(spotValue)}</span>
        </span>
      </div>

      {portfolioHistory && portfolioHistory.length > 0 ? (
        <div className="mb-5 rounded-2xl border border-separator bg-white p-3">
          <Chart
            candles={[]}
            interval={period}
            mode="area"
            areaData={portfolioHistory}
            heightClassName="h-[120px]"
          />
          <div className="mt-3 flex gap-2">
            {([
              { key: '1d', label: '1D' },
              { key: '7d', label: '7D' },
              { key: '30d', label: '1M' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  period === key
                    ? 'bg-primary text-white'
                    : 'bg-surface text-gray-600 active:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="h-[1px] bg-separator mb-5" />
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => navigate('/account/deposit')}
          className="flex-1 py-3 rounded-full bg-primary text-white text-sm font-semibold active:bg-primary-dark transition-colors"
        >
          Deposit
        </button>
        <button
          onClick={() => navigate('/account/withdraw')}
          className="flex-1 py-3 rounded-full bg-gray-100 text-foreground text-sm font-semibold active:bg-gray-200 transition-colors"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}
