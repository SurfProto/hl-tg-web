import React, { useState } from 'react';
import { PortfolioSummary, Card, TestnetToggle, Button } from '@repo/ui';
import { useUserState, usePortfolio } from '@repo/hyperliquid-sdk';
import { usePrivy } from '@privy-io/react-auth';

export function PortfolioPage() {
  const [isTestnet, setIsTestnet] = useState(
    import.meta.env.VITE_HYPERLIQUID_TESTNET === 'true'
  );
  const { authenticated } = usePrivy();

  // Fetch data
  const { data: userState } = useUserState();
  const { data: portfolio } = usePortfolio();

  // Handle deposit
  const handleDeposit = () => {
    // TODO: Implement on-ramp integration
    console.log('Deposit clicked');
    alert('On-ramp integration coming soon!');
  };

  // Handle withdraw
  const handleWithdraw = () => {
    // TODO: Implement withdrawal
    console.log('Withdraw clicked');
    alert('Withdrawal feature coming soon!');
  };

  // Handle testnet toggle
  const handleTestnetToggle = (testnet: boolean) => {
    setIsTestnet(testnet);
    // Note: This would require reloading the app with new env variable
    // For now, just update the state
    console.log('Testnet toggled:', testnet);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Network Toggle */}
      <Card>
        <TestnetToggle
          isTestnet={isTestnet}
          onToggle={handleTestnetToggle}
        />
      </Card>

      {/* Portfolio Summary */}
      <Card title="Portfolio">
        <PortfolioSummary
          accountState={userState || null}
          onDeposit={handleDeposit}
          onWithdraw={handleWithdraw}
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
            onClick={handleDeposit}
            className="p-4 bg-green-900/30 rounded-lg text-center hover:bg-green-900/50 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <p className="text-sm font-medium">Deposit</p>
          </button>
          <button
            onClick={handleWithdraw}
            className="p-4 bg-gray-800 rounded-lg text-center hover:bg-gray-700 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
            <p className="text-sm font-medium">Withdraw</p>
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
          <button
            onClick={() => window.open('https://t.me/hyperliquid', '_blank')}
            className="p-4 bg-gray-800 rounded-lg text-center hover:bg-gray-700 transition-colors"
          >
            <svg className="w-6 h-6 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm font-medium">Support</p>
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
                {/* This would show the connected wallet address */}
                0x1234...abcd
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

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 pt-4">
        <p>Hyperliquid Trading App v0.1.0</p>
        <p className="mt-1">Built with ❤️ for emerging markets</p>
      </div>
    </div>
  );
}
