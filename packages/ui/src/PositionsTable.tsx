import React from 'react';
import type { Position } from '@repo/types';
import { Button } from './Button';

interface PositionsTableProps {
  positions: Position[];
  currentPrices?: Record<string, string>;
  onClosePosition?: (coin: string) => void;
  onModifyMargin?: (coin: string, amount: number) => void;
  isLoading?: boolean;
}

export function PositionsTable({
  positions,
  currentPrices = {},
  onClosePosition,
  onModifyMargin,
  isLoading = false,
}: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </div>
        <p className="text-gray-500">No open positions</p>
        <p className="text-gray-600 text-sm mt-1">Place an order to open a position</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-left border-b border-gray-800">
            <th className="pb-3 font-medium">Coin</th>
            <th className="pb-3 font-medium">Size</th>
            <th className="pb-3 font-medium">Entry</th>
            <th className="pb-3 font-medium">Mark</th>
            <th className="pb-3 font-medium">PnL</th>
            <th className="pb-3 font-medium">Liq. Price</th>
            <th className="pb-3 font-medium">Margin</th>
            <th className="pb-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => {
            const isLong = position.szi > 0;
            const currentPrice = currentPrices[position.coin];
            const markPrice = currentPrice ? parseFloat(currentPrice) : position.entryPx;
            
            // Calculate PnL
            const priceDiff = isLong
              ? markPrice - position.entryPx
              : position.entryPx - markPrice;
            const unrealizedPnl = priceDiff * Math.abs(position.szi);
            const pnlPercent = (priceDiff / position.entryPx) * 100;
            
            const pnlColor = unrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500';
            const sizeColor = isLong ? 'text-green-500' : 'text-red-500';

            return (
              <tr key={position.coin} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-4">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${isLong ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium">{position.coin}</span>
                  </div>
                </td>
                <td className={`py-4 ${sizeColor}`}>
                  <div>
                    <span>{isLong ? '+' : ''}{position.szi.toFixed(4)}</span>
                    <span className="text-gray-500 text-xs ml-1">
                      (${(Math.abs(position.szi) * markPrice).toFixed(2)})
                    </span>
                  </div>
                </td>
                <td className="py-4 text-gray-300">
                  ${position.entryPx.toFixed(2)}
                </td>
                <td className="py-4 text-gray-300">
                  ${markPrice.toFixed(2)}
                </td>
                <td className={`py-4 ${pnlColor}`}>
                  <div>
                    <span>{unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}</span>
                    <span className="text-xs ml-1">
                      ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                    </span>
                  </div>
                </td>
                <td className="py-4 text-gray-400">
                  {position.liquidationPx
                    ? `$${position.liquidationPx.toFixed(2)}`
                    : '-'}
                </td>
                <td className="py-4 text-gray-400">
                  <div>
                    <span>${position.marginUsed.toFixed(2)}</span>
                    <span className="text-xs text-gray-500 ml-1">
                      ({position.leverage.value}x)
                    </span>
                  </div>
                </td>
                <td className="py-4">
                  <div className="flex space-x-2">
                    {onModifyMargin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onModifyMargin(position.coin, 0)}
                        loading={isLoading}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </Button>
                    )}
                    {onClosePosition && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => onClosePosition(position.coin)}
                        loading={isLoading}
                      >
                        Close
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary */}
      <div className="mt-4 pt-4 border-t border-gray-800">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Total Positions</span>
          <span className="text-gray-300">{positions.length}</span>
        </div>
        <div className="flex justify-between text-sm mt-2">
          <span className="text-gray-400">Total Unrealized PnL</span>
          <span className={`font-medium ${
            positions.reduce((sum, p) => {
              const currentPrice = currentPrices[p.coin];
              const markPrice = currentPrice ? parseFloat(currentPrice) : p.entryPx;
              const priceDiff = p.szi > 0 ? markPrice - p.entryPx : p.entryPx - markPrice;
              return sum + priceDiff * Math.abs(p.szi);
            }, 0) >= 0 ? 'text-green-500' : 'text-red-500'
          }`}>
            ${positions.reduce((sum, p) => {
              const currentPrice = currentPrices[p.coin];
              const markPrice = currentPrice ? parseFloat(currentPrice) : p.entryPx;
              const priceDiff = p.szi > 0 ? markPrice - p.entryPx : p.entryPx - markPrice;
              return sum + priceDiff * Math.abs(p.szi);
            }, 0).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
