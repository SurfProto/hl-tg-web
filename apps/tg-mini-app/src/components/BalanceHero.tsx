import { useNavigate } from 'react-router-dom';
import { useUserState, useSpotBalance, usePortfolioHistory, useMids } from '@repo/hyperliquid-sdk';
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
  const { data: mids } = useMids();

  // Perps: total equity vs available (free margin)
  const perpsValue = userState?.marginSummary?.accountValue ?? 0;
  const perpsAvailable = userState?.withdrawable ?? 0;

  // Spot: total equity and available (total - hold), priced via mids
  type SpotBalance = { coin: string; total: string; hold: string; entryNtl: string };
  const balances = spotBalance?.balances as SpotBalance[] | undefined;

  const spotValue = balances?.reduce((sum, b) => {
    const total = parseFloat(b.total ?? '0');
    if (!Number.isFinite(total) || total <= 0) return sum;
    if (b.coin === 'USDC' || b.coin === 'USDH') return sum + total;
    const mid = mids?.[b.coin] ? parseFloat(mids[b.coin]) : 0;
    return sum + total * (Number.isFinite(mid) ? mid : 0);
  }, 0) ?? 0;

  const spotAvailable = balances?.reduce((sum, b) => {
    const available = parseFloat(b.total ?? '0') - parseFloat(b.hold ?? '0');
    if (!Number.isFinite(available) || available <= 0) return sum;
    if (b.coin === 'USDC' || b.coin === 'USDH') return sum + available;
    const mid = mids?.[b.coin] ? parseFloat(mids[b.coin]) : 0;
    return sum + available * (Number.isFinite(mid) ? mid : 0);
  }, 0) ?? 0;

  const totalValue = perpsValue + spotValue;

  const perpsLocked = perpsValue - perpsAvailable > 0.005;
  const spotLocked = spotValue - spotAvailable > 0.005;

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Total equity */}
      <div className="mb-1">
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Total Equity</p>
        <p className="text-4xl font-bold text-foreground tracking-tight">
          {formatUsd(totalValue)}
        </p>
      </div>

      {/* Per-account breakdown: Perps | Spot */}
      <div className="flex gap-5 mt-2 mb-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-400 font-medium">Perps</span>
          <span className="text-xs text-gray-700 font-semibold">{formatUsd(perpsValue)}</span>
          {perpsLocked && (
            <span className="text-xs text-gray-400">{formatUsd(perpsAvailable)} avail</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-400 font-medium">Spot</span>
          <span className="text-xs text-gray-700 font-semibold">{formatUsd(spotValue)}</span>
          {spotLocked && (
            <span className="text-xs text-gray-400">{formatUsd(spotAvailable)} avail</span>
          )}
        </div>
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
