import React, { useMemo } from 'react';
import type { OrderbookLevel } from '@repo/types';

interface OrderbookProps {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  onPriceClick?: (price: number) => void;
  currentPrice?: number;
}

export function Orderbook({ bids, asks, onPriceClick, currentPrice }: OrderbookProps) {
  const { maxBidSz, maxAskSz, maxSize, bidTotal, askTotal } = useMemo(() => {
    const maxBidSz = Math.max(...bids.map((b) => b.sz), 0);
    const maxAskSz = Math.max(...asks.map((a) => a.sz), 0);
    const maxSize = Math.max(maxBidSz, maxAskSz);
    
    // Calculate cumulative totals
    let bidTotal = 0;
    let askTotal = 0;
    bids.forEach((bid) => { bidTotal += bid.px * bid.sz; });
    asks.forEach((ask) => { askTotal += ask.px * ask.sz; });

    return { maxBidSz, maxAskSz, maxSize, bidTotal, askTotal };
  }, [bids, asks]);

  const spread = asks.length > 0 && bids.length > 0
    ? asks[asks.length - 1].px - bids[0].px
    : 0;

  const spreadPercent = currentPrice
    ? (spread / currentPrice) * 100
    : 0;

  return (
    <div className="font-mono text-sm h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between text-gray-500 text-xs mb-2 px-2">
        <span>Price (USD)</span>
        <span>Size</span>
        <span>Total (USD)</span>
      </div>

      {/* Asks (Sells) - Displayed top to bottom (lowest to highest) */}
      <div className="flex-1 overflow-y-auto space-y-0.5 mb-2">
        {[...asks].reverse().slice(0, 12).map((ask, i) => {
          const depthPercent = (ask.sz / maxSize) * 100;
          const total = ask.px * ask.sz;
          const isNearPrice = currentPrice && Math.abs(ask.px - currentPrice) < currentPrice * 0.001;

          return (
            <div
              key={`ask-${i}`}
              className={`relative flex justify-between px-2 py-1 cursor-pointer hover:bg-gray-800 transition-colors ${
                isNearPrice ? 'bg-red-900/30' : ''
              }`}
              onClick={() => onPriceClick?.(ask.px)}
            >
              <div
                className="absolute inset-0 bg-red-900/20"
                style={{ width: `${depthPercent}%` }}
              />
              <span className="relative text-red-500 font-medium">
                {ask.px.toFixed(2)}
              </span>
              <span className="relative text-gray-300">
                {ask.sz.toFixed(4)}
              </span>
              <span className="relative text-gray-500">
                {total.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Spread */}
      <div className="flex justify-between items-center px-2 py-2 border-y border-gray-800 bg-gray-900/50">
        <div className="flex items-center space-x-2">
          <span className="text-gray-400">Spread</span>
          <span className="text-gray-300">{spread.toFixed(2)}</span>
        </div>
        <span className={`text-xs ${spreadPercent < 0.01 ? 'text-green-500' : spreadPercent < 0.05 ? 'text-yellow-500' : 'text-red-500'}`}>
          {spreadPercent.toFixed(3)}%
        </span>
      </div>

      {/* Bids (Buys) - Displayed top to bottom (highest to lowest) */}
      <div className="flex-1 overflow-y-auto space-y-0.5 mt-2">
        {bids.slice(0, 12).map((bid, i) => {
          const depthPercent = (bid.sz / maxSize) * 100;
          const total = bid.px * bid.sz;
          const isNearPrice = currentPrice && Math.abs(bid.px - currentPrice) < currentPrice * 0.001;

          return (
            <div
              key={`bid-${i}`}
              className={`relative flex justify-between px-2 py-1 cursor-pointer hover:bg-gray-800 transition-colors ${
                isNearPrice ? 'bg-green-900/30' : ''
              }`}
              onClick={() => onPriceClick?.(bid.px)}
            >
              <div
                className="absolute inset-0 bg-green-900/20"
                style={{ width: `${depthPercent}%` }}
              />
              <span className="relative text-green-500 font-medium">
                {bid.px.toFixed(2)}
              </span>
              <span className="relative text-gray-300">
                {bid.sz.toFixed(4)}
              </span>
              <span className="relative text-gray-500">
                {total.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="flex justify-between text-xs text-gray-500 px-2 pt-2 border-t border-gray-800 mt-2">
        <div>
          <span className="text-green-500">Bid Total: </span>
          <span>${bidTotal.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-red-500">Ask Total: </span>
          <span>${askTotal.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
