import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useArbitrumUsdcBalance, useBridgeToHyperliquid, useFundArbitrumUsdc } from '@repo/hyperliquid-sdk';

type DepositView = 'choice' | 'fiat' | 'crypto';

export function DepositPage() {
  const { user } = usePrivy();
  const [view, setView] = useState<DepositView>('choice');
  const [bridgeAmount, setBridgeAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const address = user?.wallet?.address;
  const { data: arbUsdcBalance, isLoading } = useArbitrumUsdcBalance(address);
  const fundWallet = useFundArbitrumUsdc();
  const bridge = useBridgeToHyperliquid();

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="min-h-full bg-background px-4 py-5">
      {view === 'choice' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Deposit funds</h1>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setView('fiat')} className="rounded-2xl border border-separator bg-white p-5 text-left shadow-sm">
              <svg className="h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7.5A2.5 2.5 0 015.5 5h13A2.5 2.5 0 0121 7.5v9A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9h18M16 14h2" />
              </svg>
              <p className="mt-3 font-semibold text-foreground">Buy with card</p>
              <p className="mt-1 text-sm text-muted">Fiat on-ramp placeholder</p>
            </button>
            <button type="button" onClick={() => setView('crypto')} className="rounded-2xl border border-separator bg-white p-5 text-left shadow-sm">
              <svg className="h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18M7 8.5h6a3 3 0 010 6H9a3 3 0 000 6h8" />
              </svg>
              <p className="mt-3 font-semibold text-foreground">Deposit crypto</p>
              <p className="mt-1 text-sm text-muted">Receive USDC on Arbitrum</p>
            </button>
          </div>
        </div>
      )}

      {view === 'fiat' && (
        <div className="space-y-4">
          <button type="button" onClick={() => setView('choice')} className="text-sm font-semibold text-primary">
            {'\u2190 Back'}
          </button>
          <div className="rounded-2xl border border-separator bg-white p-6 text-center shadow-sm">
            <svg className="mx-auto h-12 w-12 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
            <p className="mt-4 text-lg font-semibold text-foreground">Card on-ramp coming soon</p>
            <p className="mt-2 text-sm text-muted">Fiat deposits will be added in a later phase.</p>
          </div>
        </div>
      )}

      {view === 'crypto' && (
        <div className="space-y-4">
          <button type="button" onClick={() => setView('choice')} className="text-sm font-semibold text-primary">
            {'\u2190 Back'}
          </button>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Network</span>
              <span className="font-semibold text-foreground">Arbitrum One</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Wallet balance</span>
              <span className="font-semibold text-foreground">
                {isLoading ? 'Loading…' : `${(arbUsdcBalance ?? 0).toFixed(2)} USDC`}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-foreground">Step 1: receive USDC on Arbitrum</p>
            <button
              type="button"
              onClick={() => fundWallet.mutate({ address })}
              disabled={!address || fundWallet.isPending}
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors disabled:opacity-60"
            >
              {fundWallet.isPending ? 'Opening funding modal…' : 'Add USDC with Privy'}
            </button>
            <div className="rounded-2xl bg-surface px-4 py-3 font-mono text-sm text-foreground break-all">
              {address ?? 'Connect wallet to see your address'}
            </div>
            <button type="button" onClick={handleCopy} disabled={!address} className="w-full rounded-full bg-surface px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-50">
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-foreground">Step 2: bridge to Hyperliquid</p>
            <label htmlFor="bridge-amount" className="text-xs font-medium text-muted">Amount to bridge</label>
            <div className="flex gap-2">
              <input
                id="bridge-amount"
                type="number"
                name="bridge-amount"
                inputMode="decimal"
                autoComplete="off"
                value={bridgeAmount}
                onChange={(event) => setBridgeAmount(event.target.value)}
                placeholder="0.00"
                className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button type="button" onClick={() => setBridgeAmount((arbUsdcBalance ?? 0).toFixed(2))} className="rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-primary">
                MAX
              </button>
            </div>
            <button
              type="button"
              onClick={() => bridge.mutate({ amount: parseFloat(bridgeAmount) })}
              disabled={!bridgeAmount || parseFloat(bridgeAmount) < 5 || bridge.isPending || !address}
              className="w-full rounded-full bg-[#111827] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {bridge.isPending ? 'Bridging…' : 'Bridge to Hyperliquid'}
            </button>
            {bridge.isSuccess && <p className="text-sm text-positive">Bridge submitted. Hyperliquid balance updates in about a minute.</p>}
            {bridge.isError && <p className="text-sm text-negative">{bridge.error instanceof Error ? bridge.error.message : 'Bridge failed'}</p>}
            <p className="text-xs text-muted">Minimum bridge amount is 5 USDC. Only send USDC on Arbitrum One.</p>
          </div>
        </div>
      )}
    </div>
  );
}
