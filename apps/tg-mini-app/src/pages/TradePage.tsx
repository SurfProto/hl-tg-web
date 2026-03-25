import React, { useState, useEffect } from 'react';
import {
  MarketSelector,
  Chart,
  Orderbook,
  OrderForm,
  Card,
} from '@repo/ui';
import {
  useMarketData,
  useMids,
  useOrderbook,
  useCandles,
  usePlaceOrder,
  useUserState,
  useBuilderFeeApproval,
  useApproveBuilderFee,
} from '@repo/hyperliquid-sdk';
import type { OrderSide, OrderType } from '@repo/types';
import { useHaptics } from '../hooks/useHaptics';

export function TradePage() {
  const [selectedMarket, setSelectedMarket] = useState('BTC');
  const [interval, setInterval] = useState('1h');
  const [showOrderbook, setShowOrderbook] = useState(false);
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<any>(null);
  const haptics = useHaptics();

  // Fetch data
  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: orderbook } = useOrderbook(selectedMarket);
  const { data: candles } = useCandles(selectedMarket, interval);
  const { data: userState } = useUserState();
  const placeOrder = usePlaceOrder();
  const { data: maxBuilderFee } = useBuilderFeeApproval();
  const approveBuilder = useApproveBuilderFee();
  const isBuilderApproved = (maxBuilderFee ?? 0) > 0;

  // Get current price
  const currentPrice = mids?.[selectedMarket] ? parseFloat(mids[selectedMarket]) : undefined;

  // Get available balance
  const availableBalance = userState?.marginSummary?.accountValue || 0;

  // Get max leverage for selected market
  const selectedMarketData = markets?.perp?.find((m: any) => m.name === selectedMarket);
  const maxLeverage = selectedMarketData?.maxLeverage || 50;

  // Submit order (after approval check)
  const submitOrder = (order: {
    coin: string;
    side: OrderSide;
    orderType: OrderType;
    limitPx?: number;
    sz: number;
    reduceOnly: boolean;
  }) => {
    placeOrder.mutate({
      coin: order.coin,
      side: order.side,
      orderType: order.orderType,
      limitPx: order.limitPx,
      sz: order.sz,
      reduceOnly: order.reduceOnly,
    });
  };

  // Handle order placement - gate on builder fee approval
  const handlePlaceOrder = (order: {
    coin: string;
    side: OrderSide;
    orderType: OrderType;
    limitPx?: number;
    sz: number;
    reduceOnly: boolean;
    leverage?: number;
    takeProfitPx?: number;
    stopLossPx?: number;
  }) => {
    if (!isBuilderApproved) {
      haptics.warning();
      setPendingOrder(order);
      setShowApprovalPrompt(true);
      return;
    }
    haptics.medium();
    submitOrder(order);
  };

  // Handle builder fee approval then place pending order
  const handleApproveAndPlace = async () => {
    try {
      await approveBuilder.mutateAsync();
      haptics.success();
      setShowApprovalPrompt(false);
      if (pendingOrder) {
        submitOrder(pendingOrder);
        setPendingOrder(null);
      }
    } catch {
      haptics.error();
    }
  };

  // Handle price click from orderbook
  const handlePriceClick = (price: number) => {
    // This would set the price in the order form
    console.log('Price clicked:', price);
  };

  // Prepare market list
  const allMarkets = [
    ...(markets?.spot || []).map((t: any) => ({ ...t, type: 'spot' })),
    ...(markets?.perp || []).map((m: any) => ({ ...m, type: 'perp' })),
  ];

  // Prepare prices for market selector
  const prices: Record<string, string> = {};
  if (mids) {
    Object.entries(mids).forEach(([coin, price]) => {
      prices[coin] = String(price);
    });
  }

  return (
    <div className="p-4 space-y-4">
      {/* Market Selector */}
      <MarketSelector
        markets={allMarkets}
        selectedMarket={selectedMarket}
        onSelectMarket={setSelectedMarket}
        prices={prices}
      />

      {/* Chart */}
      <Card>
        <Chart
          candles={candles || []}
          interval={interval}
          onIntervalChange={setInterval}
          currentPrice={currentPrice}
        />
      </Card>

      {/* Orderbook Toggle */}
      <button
        onClick={() => setShowOrderbook(!showOrderbook)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 rounded-lg"
      >
        <span className="font-medium">Orderbook</span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${showOrderbook ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Orderbook (Collapsible) */}
      {showOrderbook && orderbook && (
        <Card>
          <Orderbook
            bids={orderbook.levels?.bids || []}
            asks={orderbook.levels?.asks || []}
            onPriceClick={handlePriceClick}
            currentPrice={currentPrice}
          />
        </Card>
      )}

      {/* Builder Fee Approval Prompt */}
      {showApprovalPrompt && (
        <Card>
          <div className="space-y-3">
            <h3 className="font-semibold text-yellow-400">Builder Fee Approval Required</h3>
            <p className="text-sm text-gray-400">
              To place orders, you need to approve a small builder fee (0.01%). This is a one-time approval.
            </p>
            <div className="flex space-x-2">
              <button
                onClick={handleApproveAndPlace}
                disabled={approveBuilder.isPending}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg font-medium transition-colors text-sm"
              >
                {approveBuilder.isPending ? 'Approving...' : 'Approve & Place Order'}
              </button>
              <button
                onClick={() => { setShowApprovalPrompt(false); setPendingOrder(null); }}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
            {approveBuilder.isError && (
              <p className="text-sm text-red-400">
                {approveBuilder.error instanceof Error ? approveBuilder.error.message : 'Approval failed'}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Order Form */}
      <Card title="Place Order">
        <OrderForm
          coin={selectedMarket}
          currentPrice={currentPrice}
          maxLeverage={maxLeverage}
          availableBalance={availableBalance}
          onPlaceOrder={handlePlaceOrder}
          isLoading={placeOrder.isPending}
        />
      </Card>
    </div>
  );
}
