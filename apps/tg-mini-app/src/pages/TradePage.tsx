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
} from '@repo/hyperliquid-sdk';
import type { OrderSide, OrderType } from '@repo/types';

export function TradePage() {
  const [selectedMarket, setSelectedMarket] = useState('BTC');
  const [interval, setInterval] = useState('1h');
  const [showOrderbook, setShowOrderbook] = useState(false);

  // Fetch data
  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: orderbook } = useOrderbook(selectedMarket);
  const { data: candles } = useCandles(selectedMarket, interval);
  const { data: userState } = useUserState();
  const placeOrder = usePlaceOrder();

  // Get current price
  const currentPrice = mids?.[selectedMarket] ? parseFloat(mids[selectedMarket]) : undefined;

  // Get available balance
  const availableBalance = userState?.marginSummary?.accountValue || 0;

  // Get max leverage for selected market
  const selectedMarketData = markets?.perp?.find((m: any) => m.name === selectedMarket);
  const maxLeverage = selectedMarketData?.maxLeverage || 50;

  // Handle order placement
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
    placeOrder.mutate({
      coin: order.coin,
      side: order.side,
      orderType: order.orderType,
      limitPx: order.limitPx,
      sz: order.sz,
      reduceOnly: order.reduceOnly,
    });
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
