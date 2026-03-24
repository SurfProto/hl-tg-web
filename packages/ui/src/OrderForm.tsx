import React, { useState, useMemo } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import type { OrderSide, OrderType } from '@repo/types';

interface OrderFormProps {
  coin: string;
  currentPrice?: number;
  maxLeverage?: number;
  availableBalance?: number;
  onPlaceOrder: (order: {
    coin: string;
    side: OrderSide;
    orderType: OrderType;
    limitPx?: number;
    sz: number;
    reduceOnly: boolean;
    leverage?: number;
    takeProfitPx?: number;
    stopLossPx?: number;
  }) => void;
  isLoading?: boolean;
}

export function OrderForm({
  coin,
  currentPrice,
  maxLeverage = 50,
  availableBalance = 0,
  onPlaceOrder,
  isLoading = false,
}: OrderFormProps) {
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [showTpSl, setShowTpSl] = useState(false);
  const [takeProfitPx, setTakeProfitPx] = useState('');
  const [stopLossPx, setStopLossPx] = useState('');

  // Calculate order value
  const orderValue = useMemo(() => {
    const sizeNum = parseFloat(size) || 0;
    const priceNum = orderType === 'limit' ? (parseFloat(price) || 0) : (currentPrice || 0);
    return sizeNum * priceNum;
  }, [size, price, orderType, currentPrice]);

  // Calculate margin required
  const marginRequired = useMemo(() => {
    return orderValue / leverage;
  }, [orderValue, leverage]);

  // Calculate liquidation price (simplified)
  const liquidationPrice = useMemo(() => {
    if (!currentPrice || leverage <= 1) return null;
    const maintenanceMarginRate = 0.0625; // 6.25%
    if (side === 'buy') {
      return currentPrice * (1 - (1 / leverage) + maintenanceMarginRate);
    } else {
      return currentPrice * (1 + (1 / leverage) - maintenanceMarginRate);
    }
  }, [currentPrice, leverage, side]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!size) return;

    onPlaceOrder({
      coin,
      side,
      orderType,
      limitPx: orderType === 'limit' ? parseFloat(price) : undefined,
      sz: parseFloat(size),
      reduceOnly,
      leverage,
      takeProfitPx: showTpSl && takeProfitPx ? parseFloat(takeProfitPx) : undefined,
      stopLossPx: showTpSl && stopLossPx ? parseFloat(stopLossPx) : undefined,
    });
  };

  const handlePercentageClick = (percentage: number) => {
    if (!currentPrice || availableBalance <= 0) return;
    const maxOrderValue = availableBalance * leverage * percentage;
    const sizeValue = maxOrderValue / currentPrice;
    setSize(sizeValue.toFixed(6));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Side Toggle */}
      <div className="flex space-x-2">
        <button
          type="button"
          onClick={() => setSide('buy')}
          className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
            side === 'buy'
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Buy / Long
        </button>
        <button
          type="button"
          onClick={() => setSide('sell')}
          className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
            side === 'sell'
              ? 'bg-red-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Sell / Short
        </button>
      </div>

      {/* Order Type */}
      <Select
        label="Order Type"
        value={orderType}
        onChange={(e) => setOrderType(e.target.value as OrderType)}
        options={[
          { value: 'market', label: 'Market' },
          { value: 'limit', label: 'Limit' },
        ]}
      />

      {/* Price (Limit only) */}
      {orderType === 'limit' && (
        <Input
          label="Price (USD)"
          type="number"
          placeholder={currentPrice?.toFixed(2) || '0.00'}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          step="0.01"
        />
      )}

      {/* Size */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="block text-sm font-medium text-gray-300">
            Size (USD)
          </label>
          <span className="text-xs text-gray-500">
            Available: ${availableBalance.toFixed(2)}
          </span>
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          step="0.01"
        />
        {/* Quick percentage buttons */}
        <div className="flex space-x-2 mt-2">
          {[0.25, 0.5, 0.75, 1].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercentageClick(pct)}
              className="flex-1 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700 transition-colors"
            >
              {pct * 100}%
            </button>
          ))}
        </div>
      </div>

      {/* Leverage Slider */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="block text-sm font-medium text-gray-300">
            Leverage
          </label>
          <span className="text-sm font-medium text-indigo-400">
            {leverage}x
          </span>
        </div>
        <input
          type="range"
          min="1"
          max={maxLeverage}
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1x</span>
          <span>{maxLeverage}x</span>
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Order Value</span>
          <span className="text-gray-300">${orderValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Margin Required</span>
          <span className="text-gray-300">${marginRequired.toFixed(2)}</span>
        </div>
        {liquidationPrice && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Est. Liquidation</span>
            <span className="text-red-400">${liquidationPrice.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Reduce Only */}
      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={(e) => setReduceOnly(e.target.checked)}
          className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-sm text-gray-400">Reduce Only</span>
      </label>

      {/* TP/SL Toggle */}
      <button
        type="button"
        onClick={() => setShowTpSl(!showTpSl)}
        className="flex items-center space-x-2 text-sm text-indigo-400 hover:text-indigo-300"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showTpSl ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>Take Profit / Stop Loss</span>
      </button>

      {/* TP/SL Inputs */}
      {showTpSl && (
        <div className="space-y-3 pl-4 border-l-2 border-gray-700">
          <Input
            label="Take Profit Price (USD)"
            type="number"
            placeholder="0.00"
            value={takeProfitPx}
            onChange={(e) => setTakeProfitPx(e.target.value)}
            step="0.01"
          />
          <Input
            label="Stop Loss Price (USD)"
            type="number"
            placeholder="0.00"
            value={stopLossPx}
            onChange={(e) => setStopLossPx(e.target.value)}
            step="0.01"
          />
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        variant={side === 'buy' ? 'primary' : 'danger'}
        className="w-full py-3"
        loading={isLoading}
        disabled={!size || (orderType === 'limit' && !price) || marginRequired > availableBalance}
      >
        {side === 'buy' ? 'Buy' : 'Sell'} {coin}
      </Button>
    </form>
  );
}
