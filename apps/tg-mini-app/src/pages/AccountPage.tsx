import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  useBuilderFeeApproval,
  useApproveBuilderFee,
  useFills,
  useMids,
  useSpotBalance,
  useUserState,
  getBuilderAddress,
  getBuilderFeeTenthsBp,
  isBuilderConfigured,
} from '@repo/hyperliquid-sdk';

type SpotBalance = { coin: string; total: string; hold: string; entryNtl: string };
import { useHaptics } from '../hooks/useHaptics';

function formatUsd(value: number) {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatAddress(address?: string) {
  if (!address) return 'No wallet connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function AccountPage() {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const privy = usePrivy() as any;
  const { user, authenticated } = privy;
  const { wallets } = useWallets();
  const { data: userState } = useUserState();
  const { data: spotBalance } = useSpotBalance();
  const { data: mids } = useMids();
  const { data: fills } = useFills();
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
    return balances.reduce((sum, b) => {
      const total = parseFloat(b.total ?? '0');
      if (!Number.isFinite(total) || total <= 0) return sum;
      if (b.coin === 'USDC' || b.coin === 'USDH') return sum + total;
      const mid = mids?.[b.coin] ? parseFloat(mids[b.coin]) : 0;
      return sum + total * (Number.isFinite(mid) ? mid : 0);
    }, 0);
  }, [mids, balances]);

  const spotAvailable = useMemo(() => {
    if (!balances) return 0;
    return balances.reduce((sum, b) => {
      const available = parseFloat(b.total ?? '0') - parseFloat(b.hold ?? '0');
      if (!Number.isFinite(available) || available <= 0) return sum;
      if (b.coin === 'USDC' || b.coin === 'USDH') return sum + available;
      const mid = mids?.[b.coin] ? parseFloat(mids[b.coin]) : 0;
      return sum + available * (Number.isFinite(mid) ? mid : 0);
    }, 0);
  }, [mids, balances]);

  const perpsEquity = userState?.marginSummary?.accountValue ?? 0;
  const perpsAvailable = userState?.withdrawable ?? 0;
  const totalEquity = perpsEquity + spotEquity;
  const recentFills = fills?.slice(0, 3) ?? [];
  const builderConfigured = isBuilderConfigured();
  const builderApproved = (maxFee ?? 0) > 0;

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

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Profit &amp; Loss</p>
          <p className="mt-2 text-lg font-semibold text-foreground">$0.00</p>
        </div>
        <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
          <p className="text-xs text-muted">Max Drawdown</p>
          <p className="mt-2 text-lg font-semibold text-foreground">0.00%</p>
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
          <button
            key={action.path}
            onClick={() => navigate(action.path)}
            className="rounded-2xl border border-separator bg-white px-3 py-4 text-center text-sm font-semibold text-foreground shadow-sm active:bg-surface transition-colors"
          >
            {action.label}
          </button>
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
            onClick={() => approveBuilderFee.mutate()}
            disabled={approveBuilderFee.isPending}
            className="mt-4 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {approveBuilderFee.isPending ? 'Approving...' : 'Approve builder fee'}
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-separator bg-white shadow-sm">
        <button
          onClick={() => navigate('/account/settings')}
          className="flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-foreground active:bg-surface transition-colors"
        >
          <span>Account settings</span>
          <span className="text-muted">›</span>
        </button>
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
