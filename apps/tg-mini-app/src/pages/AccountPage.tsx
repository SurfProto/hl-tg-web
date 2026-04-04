import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  getBuilderAddress,
  getBuilderFeeTenthsBp,
  isBuilderConfigured,
  useApproveBuilderFee,
  useBuilderFeeApproval,
  useFills,
  useMids,
  usePortfolioPeriod,
  useSpotBalance,
  useUserState,
} from '@repo/hyperliquid-sdk';
import type { PortfolioRange } from '@repo/types';
import { useHaptics } from '../hooks/useHaptics';
import { usePortfolioRange } from '../hooks/usePortfolioRange';
import {
  getPortfolioMaxDrawdownPct,
  getPortfolioRangePnl,
} from '../lib/portfolio';

type SpotBalance = { coin: string; total: string; hold: string; entryNtl: string };

function formatUsd(value: number) {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatAddress(address?: string) {
  if (!address) return 'No wallet connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatSignedUsd(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatDrawdownPercent(value: number) {
  return value > 0 ? `-${value.toFixed(2)}%` : '0.00%';
}

export function AccountPage() {
  const haptics = useHaptics();
  const privy = usePrivy() as any;
  const { user, authenticated } = privy;
  const { period, setPeriod } = usePortfolioRange();
  const { wallets } = useWallets();
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const { data: mids } = useMids();
  const { data: fills } = useFills();
  const { data: portfolioPeriod, isLoading: portfolioLoading } = usePortfolioPeriod(period);
  const { data: maxFee, isLoading: builderApprovalLoading } = useBuilderFeeApproval();
  const approveBuilderFee = useApproveBuilderFee();

  const walletAddress = user?.wallet?.address ?? wallets.find((wallet) => wallet.walletClientType === 'privy')?.address;
  const displayName = user?.telegram?.username
    ?? user?.email?.address
    ?? user?.wallet?.address
    ?? 'Trader';

  const balances = spotBalance?.balances as SpotBalance[] | undefined;

  const spotEquity = useMemo(() => {
    if (!balances) return 0;
    return balances.reduce((sum, balance) => {
      const total = parseFloat(balance.total ?? '0');
      if (!Number.isFinite(total) || total <= 0) return sum;
      if (balance.coin === 'USDC' || balance.coin === 'USDH') return sum + total;
      const mid = mids?.[balance.coin] ? parseFloat(mids[balance.coin]) : 0;
      return sum + total * (Number.isFinite(mid) ? mid : 0);
    }, 0);
  }, [mids, balances]);

  const spotAvailable = useMemo(() => {
    if (!balances) return 0;
    return balances.reduce((sum, balance) => {
      const available = parseFloat(balance.total ?? '0') - parseFloat(balance.hold ?? '0');
      if (!Number.isFinite(available) || available <= 0) return sum;
      if (balance.coin === 'USDC' || balance.coin === 'USDH') return sum + available;
      const mid = mids?.[balance.coin] ? parseFloat(mids[balance.coin]) : 0;
      return sum + available * (Number.isFinite(mid) ? mid : 0);
    }, 0);
  }, [mids, balances]);

  const perpsEquity = userState?.marginSummary?.accountValue ?? 0;
  const perpsAvailable = userState?.withdrawable ?? 0;
  const totalEquity = perpsEquity + spotEquity;
  const recentFills = fills?.slice(0, 3) ?? [];
  const builderConfigured = isBuilderConfigured();
  const builderApproved = (maxFee ?? 0) > 0;
  const rangePnl = useMemo(
    () => getPortfolioRangePnl(portfolioPeriod?.pnlHistory ?? []),
    [portfolioPeriod?.pnlHistory],
  );
  const maxDrawdown = useMemo(
    () => getPortfolioMaxDrawdownPct(portfolioPeriod?.accountValueHistory ?? []),
    [portfolioPeriod?.accountValueHistory],
  );
  const metricRangeLabel = period === '1d' ? '1D' : period === '7d' ? '1W' : '1M';
  const pnlColorClass =
    rangePnl > 0 ? 'text-positive' : rangePnl < 0 ? 'text-negative' : 'text-foreground';
  const drawdownColorClass = maxDrawdown > 0 ? 'text-negative' : 'text-foreground';
  const showPortfolioMetricPlaceholder = portfolioLoading || !portfolioPeriod;
  const portfolioRanges: Array<{ key: PortfolioRange; label: string }> = [
    { key: '1d', label: '1D' },
    { key: '7d', label: '1W' },
    { key: '30d', label: '1M' },
  ];

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-sm border border-separator">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Account</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">@{displayName}</h1>
            <p className="mt-1 text-sm text-muted">
              {user?.email?.address ?? 'Telegram and embedded wallet connected'}
            </p>
          </div>
          {authenticated && (
            <button
              type="button"
              onClick={() => privy.logout()}
              className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground active:bg-gray-200 transition-colors"
            >
              Log out
            </button>
          )}
        </div>

        <div className="mt-5 rounded-2xl bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Total Equity</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{formatUsd(totalEquity)}</p>
          <div className="mt-3 flex gap-5 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">Perps</span>
              <span className="font-semibold text-foreground">{formatUsd(perpsEquity)}</span>
              {perpsEquity - perpsAvailable > 0.005 && (
                <span className="text-xs text-muted">{formatUsd(perpsAvailable)} avail</span>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">Spot</span>
              <span className="font-semibold text-foreground">{formatUsd(spotEquity)}</span>
              {spotEquity - spotAvailable > 0.005 && (
                <span className="text-xs text-muted">{formatUsd(spotAvailable)} avail</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Embedded wallet</p>
            <p className="mt-1 font-mono text-sm text-muted">{formatAddress(walletAddress)}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!walletAddress) return;
              await navigator.clipboard.writeText(walletAddress);
              haptics.success();
            }}
            className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground active:bg-gray-200 transition-colors"
          >
            Copy
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Portfolio metrics</p>
            <p className="mt-1 text-xs text-muted">Synced with the home portfolio range</p>
          </div>
          <div className="chart-range-pill inline-flex items-center gap-1 rounded-full px-1.5 py-1">
            {portfolioRanges.map((range) => {
              const active = period === range.key;

              return (
                <button
                  key={range.key}
                  type="button"
                  onClick={() => setPeriod(range.key)}
                  aria-pressed={active}
                  className={`min-w-[42px] rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 ${
                    active ? 'bg-white text-foreground shadow-sm' : 'text-gray-400'
                  }`}
                >
                  {range.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Profit &amp; Loss</p>
          <p className={`mt-2 text-lg font-semibold ${showPortfolioMetricPlaceholder ? 'text-foreground' : pnlColorClass}`}>
            {showPortfolioMetricPlaceholder ? '\u2014' : formatSignedUsd(rangePnl)}
          </p>
          <p className="mt-1 text-xs text-muted">{metricRangeLabel} range</p>
        </div>
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Max Drawdown</p>
          <p className={`mt-2 text-lg font-semibold ${showPortfolioMetricPlaceholder ? 'text-foreground' : drawdownColorClass}`}>
            {showPortfolioMetricPlaceholder ? '\u2014' : formatDrawdownPercent(maxDrawdown)}
          </p>
          <p className="mt-1 text-xs text-muted">{metricRangeLabel} range</p>
        </div>
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Perps Equity</p>
          <p className="mt-2 text-lg font-semibold text-foreground">{formatUsd(perpsEquity)}</p>
        </div>
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Perps Available</p>
          <p className="mt-2 text-lg font-semibold text-foreground">{formatUsd(perpsAvailable)}</p>
        </div>
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Spot Equity</p>
          <p className="mt-2 text-lg font-semibold text-foreground">{formatUsd(spotEquity)}</p>
        </div>
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Spot Available</p>
          <p className="mt-2 text-lg font-semibold text-foreground">{formatUsd(spotAvailable)}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {([
          { label: 'Deposit', path: '/account/deposit' },
          { label: 'Withdraw', path: '/account/withdraw' },
          { label: 'Transfer', path: '/account/transfer' },
          { label: 'Swap', path: '/account/swap' },
        ] as const).map((action) => (
          <Link
            key={action.path}
            to={action.path}
            onClick={() => haptics.light()}
            className="rounded-2xl border border-separator bg-white px-3 py-4 text-center text-sm font-semibold text-foreground shadow-sm active:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {action.label}
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Builder code</p>
            <p className="mt-1 text-xs text-muted">
              {getBuilderAddress().slice(0, 6)}...{getBuilderAddress().slice(-4)} at {(getBuilderFeeTenthsBp() / 10).toFixed(1)} bp
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${builderApproved ? 'bg-green-50 text-positive' : 'bg-yellow-50 text-amber-600'}`}>
            {!builderConfigured ? 'Disabled' : builderApprovalLoading ? 'Checking' : builderApproved ? 'Approved' : 'Not approved'}
          </span>
        </div>
        {builderConfigured && !builderApproved && !builderApprovalLoading && (
          <button
            type="button"
            onClick={() => approveBuilderFee.mutate()}
            disabled={approveBuilderFee.isPending}
            className="mt-4 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {approveBuilderFee.isPending ? 'Approving…' : 'Approve builder fee'}
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-separator bg-white shadow-sm">
        <Link
          to="/account/settings"
          onClick={() => haptics.light()}
          className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-foreground active:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span>Account settings</span>
          <span className="text-muted" aria-hidden="true">{'\u203a'}</span>
        </Link>
        <div className="h-px bg-separator" />
        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-foreground">Recent fills</p>
          {recentFills.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No fills yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {recentFills.map((fill: any, index: number) => (
                <div key={`${fill.hash}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-semibold text-foreground">{fill.coin}</p>
                    <p className="text-muted">{fill.side === 'buy' ? 'Buy' : 'Sell'} {fill.sz} @ ${fill.px}</p>
                  </div>
                  <p className={`${fill.closedPnl >= 0 ? 'text-positive' : 'text-negative'} font-semibold`}>
                    {fill.closedPnl >= 0 ? '+' : ''}{fill.closedPnl.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
