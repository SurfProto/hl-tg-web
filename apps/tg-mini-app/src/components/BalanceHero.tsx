import { useNavigate } from 'react-router-dom';
import { useUserState, useSpotBalance } from '@repo/hyperliquid-sdk';

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
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();

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

      {/* Placeholder for mini chart (Phase 11) */}
      <div className="h-[1px] bg-separator mb-5" />

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
