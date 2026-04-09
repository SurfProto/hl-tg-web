import React from 'react';
import type { AccountState } from '@repo/types';

interface PortfolioSummaryProps {
  accountState: AccountState | null;
  spotUsdcBalance?: number;
  spotUsdhBalance?: number;
  walletUsdcBalance?: number;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}

export function PortfolioSummary({ accountState, spotUsdcBalance = 0, spotUsdhBalance = 0, walletUsdcBalance = 0, onDeposit, onWithdraw }: PortfolioSummaryProps) {
  if (!accountState) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-gray-500">Connect wallet to view portfolio</p>
      </div>
    );
  }

  const {
    availableBalance,
    crossMaintenanceMarginUsed,
    crossMarginSummary,
    marginSummary,
  } = accountState;
  
  // Calculate metrics
  const totalPnl = marginSummary.totalRawUsd - marginSummary.accountValue;
  const pnlColor = totalPnl >= 0 ? 'text-green-500' : 'text-red-500';
  
  const marginRatio = marginSummary.accountValue > 0
    ? (marginSummary.totalMarginUsed / marginSummary.accountValue) * 100
    : 0;
  
  const healthFactor = marginSummary.totalMarginUsed > 0
    ? marginSummary.accountValue / marginSummary.totalMarginUsed
    : Infinity;

  const getHealthColor = (factor: number) => {
    if (factor > 5) return 'text-green-500';
    if (factor > 2) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="space-y-6">
      {/* Account Value - Hero (combined) */}
      <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 rounded-xl p-6">
        <p className="text-gray-400 text-sm mb-1">Total Account Value</p>
        <p className="text-3xl font-bold">
          ${(marginSummary.accountValue + spotUsdcBalance + spotUsdhBalance + walletUsdcBalance).toFixed(2)}
        </p>
        <div className="flex items-center space-x-2 mt-2">
          <span className={`text-sm ${pnlColor}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
          <span className="text-gray-500 text-sm">Unrealized PnL</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400">
          <div className="flex justify-between">
            <span>HL Perps</span>
            <span className="text-gray-300">${marginSummary.accountValue.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Spot USDC</span>
            <span className="text-gray-300">${spotUsdcBalance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Spot USDH</span>
            <span className="text-gray-300">${spotUsdhBalance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Wallet USDC</span>
            <span className="text-gray-300">${walletUsdcBalance.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex space-x-3">
        {onDeposit && (
          <button
            onClick={onDeposit}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>Deposit</span>
          </button>
        )}
        {onWithdraw && (
          <button
            onClick={onWithdraw}
            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
            <span>Withdraw</span>
          </button>
        )}
      </div>

      {/* Margin Details */}
      <div className="bg-gray-900 rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-400">Margin Details</h3>
        
        {/* Available Balance */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-gray-400">Available Balance</span>
          </div>
          <span className="font-medium text-green-500">
            ${availableBalance.toFixed(2)}
          </span>
        </div>

        {/* Margin Used */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-yellow-500 rounded-full" />
            <span className="text-gray-400">Margin Used</span>
          </div>
          <span className="font-medium">
            ${marginSummary.totalMarginUsed.toFixed(2)}
          </span>
        </div>

        {/* Position Value */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-indigo-500 rounded-full" />
            <span className="text-gray-400">Total Position Value</span>
          </div>
          <span className="font-medium">
            ${marginSummary.totalNtlPos.toFixed(2)}
          </span>
        </div>

        {/* Maintenance Margin */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-red-500 rounded-full" />
            <span className="text-gray-400">Maintenance Margin</span>
          </div>
          <span className="font-medium">
            ${crossMaintenanceMarginUsed.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Health Metrics */}
      <div className="bg-gray-900 rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-400">Account Health</h3>
        
        {/* Margin Ratio */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400">Margin Ratio</span>
            <span className={`font-medium ${marginRatio < 50 ? 'text-green-500' : marginRatio < 80 ? 'text-yellow-500' : 'text-red-500'}`}>
              {marginRatio.toFixed(2)}%
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                marginRatio < 50 ? 'bg-green-500' : marginRatio < 80 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(marginRatio, 100)}%` }}
            />
          </div>
        </div>

        {/* Health Factor */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Health Factor</span>
          <span className={`font-medium ${getHealthColor(healthFactor)}`}>
            {healthFactor === Infinity ? '∞' : healthFactor.toFixed(2)}x
          </span>
        </div>

        {/* Leverage */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Effective Leverage</span>
          <span className="font-medium">
            {marginSummary.accountValue > 0
              ? (marginSummary.totalNtlPos / marginSummary.accountValue).toFixed(2)
              : '0.00'}x
          </span>
        </div>
      </div>

      {/* Cross Margin Summary */}
      {crossMarginSummary.accountValue > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-400">Cross Margin</h3>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Account Value</span>
            <span className="font-medium">${crossMarginSummary.accountValue.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Margin Used</span>
            <span className="font-medium">${crossMarginSummary.totalMarginUsed.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
