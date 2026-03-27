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
  isSpot?: boolean;
  onPlaceOrder: (order: {
    coin: string;
    side: OrderSide;
    orderType: OrderType;
    sizeUsd: number;
    limitPx?: number;
    reduceOnly: boolean;
    leverage?: number;
  }) => void;
  isLoading?: boolean;
}

export function OrderForm({
  coin,
  currentPrice,
  maxLeverage = 50,
  availableBalance = 0,
  isSpot = false,
  onPlaceOrder,
  isLoading = false,
}: OrderFormProps) {
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Calculate order value (size is already in USD)
  const orderValue = useMemo(() => {
    return parseFloat(size) || 0;
  }, [size]);

  // Calculate margin required
  const marginRequired = useMemo(() => {
    return orderValue / leverage;
  }, [orderValue, leverage]);

  // Calculate liquidation price (simplified)
  const liquidationPrice = useMemo(() => {
    if (!currentPrice || leverage <= 1) return null;
    const maintenanceMarginRate = 0.005; // ~0.5% of notional (Hyperliquid high-leverage tier)
    if (side === 'buy') {
      return currentPrice * (1 - (1 / leverage) + maintenanceMarginRate);
    } else {
      return currentPrice * (1 + (1 / leverage) - maintenanceMarginRate);
    }
  }, [currentPrice, leverage, side]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sizeNum = parseFloat(size);
    if (!size || isNaN(sizeNum) || sizeNum <= 0) return;
    setShowConfirmation(true);
  };

  const handleConfirmOrder = () => {
    const sizeNum = parseFloat(size);
    setShowConfirmation(false);
    onPlaceOrder({
      coin,
      side,
      orderType,
      sizeUsd: sizeNum,
      limitPx: orderType === 'limit' ? parseFloat(price) : undefined,
      reduceOnly,
      leverage,
    });
  };

  const handlePercentageClick = (percentage: number) => {
    if (availableBalance <= 0) return;
    const maxUsd = availableBalance * leverage * percentage;
    setSize(maxUsd.toFixed(2));
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
          {isSpot ? 'Buy' : 'Buy / Long'}
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
          {isSpot ? 'Sell' : 'Sell / Short'}
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
        {size && currentPrice && parseFloat(size) > 0 && (
          <span className="block text-xs text-gray-500 mt-1">
            ≈ {(parseFloat(size) / currentPrice).toFixed(6)} {coin}
          </span>
        )}
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

      {/* Leverage Slider (perps only) */}
      {!isSpot && (
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
      )}

      {/* Order Summary */}
      <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Order Value</span>
          <span className="text-gray-300">${orderValue.toFixed(2)}</span>
        </div>
        {!isSpot && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Margin Required</span>
            <span className="text-gray-300">${marginRequired.toFixed(2)}</span>
          </div>
        )}
        {!isSpot && liquidationPrice && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Est. Liquidation</span>
            <span className="text-red-400">${liquidationPrice.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Reduce Only */}
      {!isSpot && (
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
            className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-400">Reduce Only</span>
        </label>
      )}

      {/* Order Confirmation */}
      {showConfirmation && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-3 border border-gray-700">
          <h3 className="font-semibold text-center">Confirm Order</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Side</span>
              <span className={side === 'buy' ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
                {side === 'buy' ? (isSpot ? 'Buy' : 'Buy / Long') : (isSpot ? 'Sell' : 'Sell / Short')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Market</span>
              <span className="font-medium">{coin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Type</span>
              <span className="font-medium">{orderType === 'market' ? 'Market' : 'Limit'}</span>
            </div>
            {orderType === 'limit' && (
              <div className="flex justify-between">
                <span className="text-gray-400">Limit Price</span>
                <span className="font-medium">${parseFloat(price).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-400">Size</span>
              <span className="font-medium">${orderValue.toFixed(2)}</span>
            </div>
            {currentPrice && parseFloat(size) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-400">Quantity</span>
                <span className="font-medium">{(parseFloat(size) / currentPrice).toFixed(6)} {coin}</span>
              </div>
            )}
            {!isSpot && (
              <div className="flex justify-between">
                <span className="text-gray-400">Leverage</span>
                <span className="font-medium text-indigo-400">{leverage}x</span>
              </div>
            )}
            {!isSpot && (
              <div className="flex justify-between">
                <span className="text-gray-400">Margin</span>
                <span className="font-medium">${marginRequired.toFixed(2)}</span>
              </div>
            )}
            {!isSpot && liquidationPrice && (
              <div className="flex justify-between">
                <span className="text-gray-400">Est. Liquidation</span>
                <span className="text-red-400 font-medium">${liquidationPrice.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div className="flex space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setShowConfirmation(false)}
              className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmOrder}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-colors text-sm ${
                side === 'buy'
                  ? 'bg-green-600 hover:bg-green-500'
                  : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              Confirm {side === 'buy' ? 'Buy' : 'Sell'}
            </button>
          </div>
        </div>
      )}

      {/* Submit Button */}
      {!showConfirmation && (
        <Button
          type="submit"
          variant={side === 'buy' ? 'primary' : 'danger'}
          className="w-full py-3"
          loading={isLoading}
          disabled={!size || (orderType === 'limit' && !price) || marginRequired > availableBalance}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {coin}
        </Button>
      )}
    </form>
  );
}
