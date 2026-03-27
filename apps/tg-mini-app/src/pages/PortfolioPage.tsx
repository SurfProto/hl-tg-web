import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PortfolioSummary, Card } from '@repo/ui';
import { useUserState, usePortfolio, useSpotBalance, useUsdClassTransfer, useWithdraw, useArbitrumUsdcBalance, useFundArbitrumUsdc, useBridgeToHyperliquid, useSwapUsdcUsdh, useBuilderFeeApproval, useApproveBuilderFee, BUILDER_ADDRESS, BUILDER_FEE_TENTHS_BP } from '@repo/hyperliquid-sdk';
import { usePrivy } from '@privy-io/react-auth';
import { useHaptics } from '../hooks/useHaptics';

type View = 'main' | 'deposit-choice' | 'deposit-fiat' | 'deposit-crypto' | 'withdraw' | 'transfer' | 'swap';

// ── Sub-views ────────────────────────────────────────────────────────────────

function DepositChoiceView({ onSelect }: { onSelect: (v: View) => void }) {
  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Deposit funds</h2>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onSelect('deposit-fiat')}
          className="p-5 bg-gray-800 rounded-xl text-left hover:bg-gray-700 transition-colors"
        >
          <div className="text-2xl mb-2">💳</div>
          <p className="font-medium">Buy with card</p>
          <p className="text-xs text-gray-400 mt-1">Fiat on-ramp</p>
        </button>
        <button
          onClick={() => onSelect('deposit-crypto')}
          className="p-5 bg-gray-800 rounded-xl text-left hover:bg-gray-700 transition-colors"
        >
          <div className="text-2xl mb-2">₿</div>
          <p className="font-medium">Deposit crypto</p>
          <p className="text-xs text-gray-400 mt-1">Send to your wallet</p>
        </button>
      </div>
    </div>
  );
}

function DepositFiatView() {
  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Buy with card</h2>
      <div className="bg-gray-800 rounded-xl p-6 text-center space-y-3">
        <div className="text-4xl">🚧</div>
        <p className="font-medium">On-ramp coming soon</p>
        <p className="text-sm text-gray-400">
          Fiat-to-crypto purchasing will be available in a future update.
        </p>
      </div>
    </div>
  );
}

function DepositCryptoView({ address }: { address: string | undefined }) {
  const [copied, setCopied] = useState(false);
  const [bridgeAmount, setBridgeAmount] = useState('');
  const { data: arbUsdcBalance, isLoading: arbBalanceLoading } = useArbitrumUsdcBalance(address);
  const fundWallet = useFundArbitrumUsdc();
  const bridge = useBridgeToHyperliquid();

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleBridge = () => {
    const amt = parseFloat(bridgeAmount);
    if (!amt || amt <= 0) return;
    bridge.mutate({ amount: amt }, { onSuccess: () => setBridgeAmount('') });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Deposit USDC</h2>

      {/* Step 1 */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step 1 — Receive USDC on Arbitrum</p>
        <div className="bg-gray-800 rounded-xl divide-y divide-gray-700">
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-gray-400">Network</span>
            <span className="font-medium">Arbitrum One</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-gray-400">Wallet balance</span>
            <span className={`font-medium ${(arbUsdcBalance ?? 0) > 0 ? 'text-green-400' : 'text-gray-400'}`}>
              {arbBalanceLoading ? '…' : `${(arbUsdcBalance ?? 0).toFixed(2)} USDC`}
            </span>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <button
            onClick={() => fundWallet.mutate({ address })}
            disabled={!address || fundWallet.isPending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
          >
            {fundWallet.isPending ? 'Opening funding modal...' : 'Add USDC with Privy'}
          </button>
          <p className="text-xs text-gray-500">
            This opens Privy funding for USDC on Arbitrum. You can still use the wallet address below for manual deposits.
          </p>
          <p className="text-sm text-gray-400">Your Arbitrum address</p>
          {address ? (
            <>
              <div className="bg-gray-800 rounded-xl px-4 py-3 font-mono text-sm break-all">{address}</div>
              <button
                onClick={handleCopy}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium transition-colors"
              >
                {copied ? '✓ Copied!' : '📋 Copy address'}
              </button>
              {fundWallet.isError && (
                <p className="text-center text-sm text-red-400">
                  {fundWallet.error instanceof Error ? fundWallet.error.message : 'Unable to open funding modal'}
                </p>
              )}
            </>
          ) : (
            <div className="bg-gray-800 rounded-xl px-4 py-3 text-gray-500 text-sm">Connect wallet to see your address</div>
          )}
        </div>
      </div>

      {/* Step 2 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step 2 — Bridge to Hyperliquid</p>
        <p className="text-sm text-gray-400">Once you have USDC in your Arbitrum wallet, bridge it to start trading on Hyperliquid.</p>

        <div className="flex space-x-2">
          <input
            type="number"
            placeholder="Amount to bridge"
            value={bridgeAmount}
            onChange={(e) => setBridgeAmount(e.target.value)}
            className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => setBridgeAmount((arbUsdcBalance ?? 0).toFixed(2))}
            className="px-4 py-3 bg-gray-800 rounded-xl text-sm text-indigo-400 hover:bg-gray-700 transition-colors"
          >
            MAX
          </button>
        </div>

        {bridgeAmount && parseFloat(bridgeAmount) > 0 && parseFloat(bridgeAmount) < 5 && (
          <p className="text-sm text-yellow-400">Minimum deposit is 5 USDC. Smaller amounts will be permanently lost.</p>
        )}

        <button
          onClick={handleBridge}
          disabled={!bridgeAmount || parseFloat(bridgeAmount) < 5 || bridge.isPending || !address}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
        >
          {bridge.isPending ? 'Bridging…' : 'Bridge to Hyperliquid'}
        </button>

        {bridge.isSuccess && (
          <p className="text-center text-sm text-green-400">Bridge submitted! HL balance updates in ~1 minute.</p>
        )}
        {bridge.isError && (
          <p className="text-center text-sm text-red-400">
            {bridge.error instanceof Error ? bridge.error.message : 'Bridge failed'}
          </p>
        )}
      </div>

      <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-sm text-yellow-300 space-y-1">
        <p className="font-medium">⚠️ Important</p>
        <p>Only send USDC on the Arbitrum One network to this address.</p>
        <p>Sending on a different network will result in permanent loss of funds.</p>
      </div>
    </div>
  );
}

function WithdrawView({ withdrawable, destination }: { withdrawable: number; destination: string | undefined }) {
  const [amount, setAmount] = useState('');
  const withdraw = useWithdraw();

  const handleWithdraw = () => {
    if (!destination || !amount || parseFloat(amount) <= 0) return;
    withdraw.mutate({ destination, amount });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Withdraw USDC</h2>

      <div className="bg-gray-800 rounded-xl divide-y divide-gray-700">
        <div className="flex justify-between items-center px-4 py-3">
          <span className="text-gray-400">Asset</span>
          <span className="font-medium">USDC</span>
        </div>
        <div className="flex justify-between items-center px-4 py-3">
          <span className="text-gray-400">Withdrawal chain</span>
          <span className="font-medium">Arbitrum</span>
        </div>
        <div className="flex justify-between items-center px-4 py-3">
          <span className="text-gray-400">Destination</span>
          <span className="font-mono text-xs text-gray-300">
            {destination ? `${destination.slice(0, 6)}...${destination.slice(-4)}` : 'No wallet'}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-sm text-gray-400">Amount</label>
          <span className="text-xs text-gray-500">Available: {withdrawable.toFixed(2)} USDC</span>
        </div>
        <div className="flex space-x-2">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => setAmount(withdrawable.toFixed(2))}
            className="px-4 py-3 bg-gray-800 rounded-xl text-sm text-indigo-400 hover:bg-gray-700 transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      <button
        onClick={handleWithdraw}
        disabled={!amount || parseFloat(amount) <= 0 || !destination || withdraw.isPending}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        {withdraw.isPending ? 'Submitting…' : 'Withdraw to Arbitrum'}
      </button>

      {withdraw.isSuccess && (
        <p className="text-center text-sm text-green-400">Withdrawal submitted. Arrives in ~5 min.</p>
      )}
      {withdraw.isError && (
        <p className="text-center text-sm text-red-400">
          {withdraw.error instanceof Error ? withdraw.error.message : 'Withdrawal failed'}
        </p>
      )}

      <div className="text-xs text-gray-500 space-y-1">
        <p>USDC will be sent over the Arbitrum network to your address.</p>
        <p>A 1 USDC fee will be deducted from the amount withdrawn.</p>
        <p>Withdrawals should arrive within 5 minutes.</p>
      </div>
    </div>
  );
}

function TransferView({ perpsBalance, spotBalance }: { perpsBalance: number; spotBalance: number }) {
  const [direction, setDirection] = useState<'perps-to-spot' | 'spot-to-perps'>('perps-to-spot');
  const [amount, setAmount] = useState('');
  const transfer = useUsdClassTransfer();

  const fromBalance = direction === 'perps-to-spot' ? perpsBalance : spotBalance;
  const fromLabel = direction === 'perps-to-spot' ? 'Perps' : 'Spot';
  const toLabel = direction === 'perps-to-spot' ? 'Spot' : 'Perps';

  const handleConfirm = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    // toPerp=true means Spot→Perps; toPerp=false means Perps→Spot
    transfer.mutate(
      { amount, toPerp: direction === 'spot-to-perps' },
      { onSuccess: () => setAmount('') }
    );
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Transfer USDC</h2>
      <p className="text-sm text-gray-400">Transfer USDC between your Perps and Spot balances.</p>

      <div className="flex items-center justify-center space-x-3">
        <span className={`font-medium ${direction === 'perps-to-spot' ? 'text-white' : 'text-gray-400'}`}>
          {fromLabel}
        </span>
        <button
          onClick={() => { setDirection(d => d === 'perps-to-spot' ? 'spot-to-perps' : 'perps-to-spot'); setAmount(''); }}
          className="p-2 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors text-indigo-400"
        >
          ⇄
        </button>
        <span className={`font-medium ${direction === 'spot-to-perps' ? 'text-white' : 'text-gray-400'}`}>
          {toLabel}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-sm text-gray-400">Amount</label>
          <span className="text-xs text-indigo-400">MAX: {fromBalance.toFixed(2)}</span>
        </div>
        <div className="flex space-x-2">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => setAmount(fromBalance.toFixed(2))}
            className="px-4 py-3 bg-gray-800 rounded-xl text-sm text-indigo-400 hover:bg-gray-700 transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      <button
        onClick={handleConfirm}
        disabled={!amount || parseFloat(amount) <= 0 || transfer.isPending}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        {transfer.isPending ? 'Submitting…' : 'Confirm'}
      </button>

      {transfer.isSuccess && (
        <p className="text-center text-sm text-green-400">Transfer submitted successfully.</p>
      )}
      {transfer.isError && (
        <p className="text-center text-sm text-red-400">
          {transfer.error instanceof Error ? transfer.error.message : 'Transfer failed'}
        </p>
      )}
    </div>
  );
}

function SwapView({ usdhBalance, usdcBalance }: { usdhBalance: number; usdcBalance: number }) {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy'); // buy = USDC→USDH, sell = USDH→USDC
  const [amount, setAmount] = useState('');
  const swap = useSwapUsdcUsdh();

  const fromLabel = direction === 'buy' ? 'USDC' : 'USDH';
  const toLabel = direction === 'buy' ? 'USDH' : 'USDC';
  const fromBalance = direction === 'buy' ? usdcBalance : usdhBalance;

  const handleSwap = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    swap.mutate({ amount: amt, direction }, { onSuccess: () => setAmount('') });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Swap USDC / USDH</h2>
      <p className="text-sm text-gray-400">Swap between USDC and USDH on Hyperliquid spot.</p>

      <div className="flex items-center justify-center space-x-3">
        <span className="font-medium text-white">{fromLabel}</span>
        <button
          onClick={() => { setDirection(d => d === 'buy' ? 'sell' : 'buy'); setAmount(''); }}
          className="p-2 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors text-indigo-400"
        >
          ⇄
        </button>
        <span className="font-medium text-white">{toLabel}</span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-sm text-gray-400">Amount ({fromLabel})</label>
          <span className="text-xs text-indigo-400">Balance: {fromBalance.toFixed(2)}</span>
        </div>
        <div className="flex space-x-2">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => setAmount(fromBalance.toFixed(2))}
            className="px-4 py-3 bg-gray-800 rounded-xl text-sm text-indigo-400 hover:bg-gray-700 transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      <button
        onClick={handleSwap}
        disabled={!amount || parseFloat(amount) <= 0 || swap.isPending}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        {swap.isPending ? 'Swapping…' : `Swap ${fromLabel} → ${toLabel}`}
      </button>

      {swap.isSuccess && (
        <p className="text-center text-sm text-green-400">Swap completed!</p>
      )}
      {swap.isError && (
        <p className="text-center text-sm text-red-400">
          {swap.error instanceof Error ? swap.error.message : 'Swap failed'}
        </p>
      )}

      <div className="text-xs text-gray-500">
        <p>USDH ≈ 1 USDC. Swap executes as a market order on the USDH/USDC spot pair.</p>
      </div>
    </div>
  );
}

function BuilderCodeCard() {
  const { data: maxFee, isLoading } = useBuilderFeeApproval();
  const approve = useApproveBuilderFee();
  const haptics = useHaptics();
  const isApproved = (maxFee ?? 0) > 0;
  const feeDisplay = `${(BUILDER_FEE_TENTHS_BP / 10).toFixed(1)} bp`;

  return (
    <Card title="Builder Code">
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Status</span>
          {isLoading ? (
            <span className="text-gray-500 text-sm">Checking...</span>
          ) : isApproved ? (
            <span className="text-green-500 font-medium">Approved</span>
          ) : (
            <span className="text-yellow-500 font-medium">Not Approved</span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Fee Rate</span>
          <span className="font-medium">{feeDisplay}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Address</span>
          <span className="font-mono text-xs text-gray-500">
            {BUILDER_ADDRESS.slice(0, 6)}...{BUILDER_ADDRESS.slice(-4)}
          </span>
        </div>
        {!isLoading && !isApproved && (
          <button
            onClick={() => { haptics.medium(); approve.mutate(); }}
            disabled={approve.isPending}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors text-sm"
          >
            {approve.isPending ? 'Approving...' : 'Approve Builder Fee'}
          </button>
        )}
        {approve.isSuccess && (
          <p className="text-center text-sm text-green-400">Builder fee approved!</p>
        )}
        {approve.isError && (
          <p className="text-center text-sm text-red-400">
            {approve.error instanceof Error ? approve.error.message : 'Approval failed'}
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const [view, setView] = useState<View>('main');
  const { authenticated, user, linkEmail } = usePrivy();

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: userState } = useUserState();
  const { data: portfolio } = usePortfolio();
  const { data: spotData } = useSpotBalance();

  const walletAddress = user?.wallet?.address;
  const { data: arbUsdcBalance } = useArbitrumUsdcBalance(walletAddress);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['userState'] }),
      queryClient.invalidateQueries({ queryKey: ['spotBalance'] }),
      queryClient.invalidateQueries({ queryKey: ['arbitrumUsdc'] }),
    ]);
    setRefreshing(false);
  };

  // TMA BackButton wiring
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    if (view !== 'main') {
      tg.BackButton.show();
      const handler = () => setView('main');
      tg.BackButton.onClick(handler);
      return () => {
        tg.BackButton.offClick(handler);
        tg.BackButton.hide();
      };
    } else {
      tg.BackButton.hide();
    }
  }, [view]);

  const withdrawable = userState?.withdrawable ?? 0;
  const perpsBalance = userState?.marginSummary?.accountValue ?? 0;
  // Spot balances from spot clearinghouse state
  const spotUsdcRaw = spotData?.balances?.find((b: any) => b.coin === 'USDC')?.total;
  const spotUsdcBalance = parseFloat(spotUsdcRaw ?? '0') || 0;
  const spotUsdhRaw = spotData?.balances?.find((b: any) => b.coin === 'USDH')?.total;
  const spotUsdhBalance = parseFloat(spotUsdhRaw ?? '0') || 0;
  const walletUsdcBalance = arbUsdcBalance ?? 0;

  if (view !== 'main') {
    return (
      <div className="min-h-screen bg-black">
        {view === 'deposit-choice' && <DepositChoiceView onSelect={setView} />}
        {view === 'deposit-fiat' && <DepositFiatView />}
        {view === 'deposit-crypto' && <DepositCryptoView address={walletAddress} />}
        {view === 'withdraw' && <WithdrawView withdrawable={withdrawable} destination={walletAddress} />}
        {view === 'transfer' && <TransferView perpsBalance={perpsBalance} spotBalance={spotUsdcBalance} />}
        {view === 'swap' && <SwapView usdhBalance={spotUsdhBalance} usdcBalance={spotUsdcBalance} />}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Portfolio Summary */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Portfolio</h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`text-gray-400 hover:text-white transition-colors disabled:opacity-40 text-xl leading-none select-none ${refreshing ? 'animate-spin' : ''}`}
            title="Refresh balances"
          >
            ↻
          </button>
        </div>
        <PortfolioSummary
          accountState={userState || null}
          spotUsdcBalance={spotUsdcBalance}
          spotUsdhBalance={spotUsdhBalance}
          walletUsdcBalance={walletUsdcBalance}
          onDeposit={() => setView('deposit-choice')}
          onWithdraw={() => setView('withdraw')}
        />
      </Card>

      {/* Builder Code Status */}
      <BuilderCodeCard />

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => setView('deposit-choice')}
            className="p-4 bg-green-900/30 rounded-lg text-center hover:bg-green-900/50 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <p className="text-sm font-medium">Deposit</p>
          </button>
          <button
            onClick={() => setView('withdraw')}
            className="p-4 bg-gray-800 rounded-lg text-center hover:bg-gray-700 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
            <p className="text-sm font-medium">Withdraw</p>
          </button>
          <button
            onClick={() => setView('transfer')}
            className="p-4 bg-gray-800 rounded-lg text-center hover:bg-gray-700 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            <p className="text-sm font-medium">Transfer</p>
          </button>
          <button
            onClick={() => setView('swap')}
            className="p-4 bg-indigo-900/30 rounded-lg text-center hover:bg-indigo-900/50 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <p className="text-sm font-medium">Swap</p>
          </button>
          <button
            onClick={() => window.open('https://app.hyperliquid.xyz', '_blank')}
            className="p-4 bg-gray-800 rounded-lg text-center hover:bg-gray-700 transition-colors col-span-2"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <p className="text-sm font-medium">Hyperliquid</p>
          </button>
        </div>
      </Card>

      {/* Account Info */}
      {authenticated && (
        <Card title="Account">
          {(() => {
            const hasEmail = user?.linkedAccounts?.some((a: any) => a.type === 'email');
            const hasTelegram = user?.linkedAccounts?.some((a: any) => a.type === 'telegram');
            return (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Wallet</span>
                  <span className="font-mono text-xs">
                    {walletAddress
                      ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                      : 'No wallet'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Network</span>
                  <span className="font-medium text-green-500">Mainnet</span>
                </div>
                {hasTelegram && !hasEmail && (
                  <button
                    onClick={() => linkEmail()}
                    className="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm text-indigo-400 transition-colors"
                  >
                    + Link email (backup login)
                  </button>
                )}
              </div>
            );
          })()}
        </Card>
      )}

      <div className="text-center text-xs text-gray-600 pt-4">
        <p>Hyperliquid Trading App v0.1.0</p>
        <p className="mt-1">Built with ❤️ for emerging markets</p>
      </div>
    </div>
  );
}
