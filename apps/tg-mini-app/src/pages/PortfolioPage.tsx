import React, { useState, useEffect } from 'react';
import { PortfolioSummary, Card, TestnetToggle } from '@repo/ui';
import { useUserState, usePortfolio } from '@repo/hyperliquid-sdk';
import { usePrivy } from '@privy-io/react-auth';

type View = 'main' | 'deposit-choice' | 'deposit-fiat' | 'deposit-crypto' | 'withdraw' | 'transfer';

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

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Deposit USDC</h2>

      <div className="bg-gray-800 rounded-xl divide-y divide-gray-700">
        <div className="flex justify-between items-center px-4 py-3">
          <span className="text-gray-400">Token</span>
          <span className="font-medium">USDC</span>
        </div>
        <div className="flex justify-between items-center px-4 py-3">
          <span className="text-gray-400">Network</span>
          <span className="font-medium">Arbitrum One</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-400">Your deposit address</p>
        {address ? (
          <>
            <div className="bg-gray-800 rounded-xl px-4 py-3 font-mono text-sm break-all">
              {address}
            </div>
            <button
              onClick={handleCopy}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-medium transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy address'}
            </button>
          </>
        ) : (
          <div className="bg-gray-800 rounded-xl px-4 py-3 text-gray-500 text-sm">
            Connect wallet to see your address
          </div>
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

function WithdrawView({ withdrawable }: { withdrawable: number }) {
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);

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
        onClick={() => setSubmitted(true)}
        disabled={!amount || parseFloat(amount) <= 0}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        Withdraw to Arbitrum
      </button>

      {submitted && (
        <p className="text-center text-sm text-yellow-400">Withdrawal execution coming soon.</p>
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
  const [submitted, setSubmitted] = useState(false);

  const fromBalance = direction === 'perps-to-spot' ? perpsBalance : spotBalance;
  const fromLabel = direction === 'perps-to-spot' ? 'Perps' : 'Spot';
  const toLabel = direction === 'perps-to-spot' ? 'Spot' : 'Perps';

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">Transfer USDC</h2>
      <p className="text-sm text-gray-400">Transfer USDC between your Perps and Spot balances.</p>

      <div className="flex items-center justify-center space-x-3">
        <span className={`font-medium ${direction === 'perps-to-spot' ? 'text-white' : 'text-gray-400'}`}>
          {fromLabel}
        </span>
        <button
          onClick={() => setDirection(d => d === 'perps-to-spot' ? 'spot-to-perps' : 'perps-to-spot')}
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
        onClick={() => setSubmitted(true)}
        disabled={!amount || parseFloat(amount) <= 0}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        Confirm
      </button>

      {submitted && (
        <p className="text-center text-sm text-yellow-400">Transfer execution coming soon.</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const [isTestnet, setIsTestnet] = useState(
    import.meta.env.VITE_HYPERLIQUID_TESTNET === 'true'
  );
  const [view, setView] = useState<View>('main');
  const { authenticated, user } = usePrivy();

  const { data: userState } = useUserState();
  const { data: portfolio } = usePortfolio();

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

  const walletAddress = user?.wallet?.address;
  const withdrawable = parseFloat((userState as any)?.withdrawable ?? '0') || 0;
  const perpsBalance = parseFloat((userState as any)?.marginSummary?.accountValue ?? '0') || 0;
  const spotBalance = parseFloat((userState as any)?.spotState?.balances?.[0]?.total ?? '0') || 0;

  if (view !== 'main') {
    return (
      <div className="min-h-screen bg-black">
        {view === 'deposit-choice' && <DepositChoiceView onSelect={setView} />}
        {view === 'deposit-fiat' && <DepositFiatView />}
        {view === 'deposit-crypto' && <DepositCryptoView address={walletAddress} />}
        {view === 'withdraw' && <WithdrawView withdrawable={withdrawable} />}
        {view === 'transfer' && <TransferView perpsBalance={perpsBalance} spotBalance={spotBalance} />}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Network Toggle */}
      <Card>
        <TestnetToggle
          isTestnet={isTestnet}
          onToggle={(testnet) => {
            setIsTestnet(testnet);
            console.log('Testnet toggled:', testnet);
          }}
        />
      </Card>

      {/* Portfolio Summary */}
      <Card title="Portfolio">
        <PortfolioSummary
          accountState={userState || null}
          onDeposit={() => setView('deposit-choice')}
          onWithdraw={() => setView('withdraw')}
        />
      </Card>

      {/* Builder Code Status */}
      <Card title="Builder Code">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Status</span>
            <span className="text-green-500 font-medium">Active</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Fee Rate</span>
            <span className="font-medium">
              {import.meta.env.VITE_BUILDER_FEE || '10'} tenths/bp
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Address</span>
            <span className="font-mono text-xs text-gray-500">
              {(import.meta.env.VITE_BUILDER_ADDRESS || '0x0000...0000').slice(0, 6)}...
              {(import.meta.env.VITE_BUILDER_ADDRESS || '0x0000...0000').slice(-4)}
            </span>
          </div>
        </div>
      </Card>

      {/* Quick Actions */}
      <Card title="Quick Actions">
        <div className="grid grid-cols-2 gap-3">
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
            onClick={() => window.open('https://app.hyperliquid.xyz', '_blank')}
            className="p-4 bg-gray-800 rounded-lg text-center hover:bg-gray-700 transition-colors"
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
              <span className={`font-medium ${isTestnet ? 'text-yellow-500' : 'text-green-500'}`}>
                {isTestnet ? 'Testnet' : 'Mainnet'}
              </span>
            </div>
          </div>
        </Card>
      )}

      <div className="text-center text-xs text-gray-600 pt-4">
        <p>Hyperliquid Trading App v0.1.0</p>
        <p className="mt-1">Built with ❤️ for emerging markets</p>
      </div>
    </div>
  );
}
