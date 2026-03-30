import { useState } from 'react';
import { useSpotBalance, useSwapUsdcUsdh } from '@repo/hyperliquid-sdk';

export function SwapPage() {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const swap = useSwapUsdcUsdh();
  const { data: spotBalance } = useSpotBalance();

  const usdcBalance = parseFloat(
    spotBalance?.balances?.find((balance: any) => balance.coin === 'USDC')?.total ?? '0',
  ) || 0;
  const usdhBalance = parseFloat(
    spotBalance?.balances?.find((balance: any) => balance.coin === 'USDH')?.total ?? '0',
  ) || 0;

  const fromBalance = direction === 'buy' ? usdcBalance : usdhBalance;
  const fromLabel = direction === 'buy' ? 'USDC' : 'USDH';
  const toLabel = direction === 'buy' ? 'USDH' : 'USDC';

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Swap USDC / USDH</h1>

      <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-center gap-3">
          <span className="text-sm font-semibold text-foreground">{fromLabel}</span>
          <button
            onClick={() => {
              setDirection((current) => current === 'buy' ? 'sell' : 'buy');
              setAmount('');
            }}
            className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-primary"
          >
            ⇄
          </button>
          <span className="text-sm font-semibold text-foreground">{toLabel}</span>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-foreground">Amount ({fromLabel})</label>
          <span className="text-xs text-muted">Balance {fromBalance.toFixed(2)}</span>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground outline-none"
          />
          <button onClick={() => setAmount(fromBalance.toFixed(2))} className="rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-primary">
            MAX
          </button>
        </div>
        <button
          onClick={() => swap.mutate({ amount: parseFloat(amount), direction })}
          disabled={!amount || parseFloat(amount) <= 0 || swap.isPending}
          className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {swap.isPending ? 'Swapping...' : `Swap ${fromLabel} to ${toLabel}`}
        </button>
        {swap.isSuccess && <p className="text-sm text-positive">Swap completed successfully.</p>}
        {swap.isError && <p className="text-sm text-negative">{swap.error instanceof Error ? swap.error.message : 'Swap failed'}</p>}
        <p className="text-xs text-muted">USDH is expected to trade close to 1 USDC and uses a market order under the hood.</p>
      </div>
    </div>
  );
}
