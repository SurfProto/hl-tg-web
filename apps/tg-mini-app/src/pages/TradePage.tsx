import React, { useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
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
  usePlaceSpotOrder,
  useSpotBalance,
  useUserState,
  useBuilderFeeApproval,
  useApproveBuilderFee,
  enrichMarkets,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  isBuilderConfigured,
} from '@repo/hyperliquid-sdk';
import type { AnyMarket, Order } from '@repo/types';
import { useHaptics } from '../hooks/useHaptics';

export function TradePage() {
  const [selectedMarket, setSelectedMarket] = useState('BTC');
  const [interval, setInterval] = useState('1h');
  const [showOrderbook, setShowOrderbook] = useState(false);
  const haptics = useHaptics();
  const { authenticated } = usePrivy();

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: orderbook } = useOrderbook(selectedMarket);
  const { data: candles } = useCandles(selectedMarket, interval);
  const { data: userState } = useUserState();
  const placeOrder = usePlaceOrder();
  const placeSpotOrder = usePlaceSpotOrder();
  const { data: spotData } = useSpotBalance();
  const { data: maxBuilderFee, isLoading: isApprovalLoading } = useBuilderFeeApproval();
  const approveBuilder = useApproveBuilderFee();

  const builderConfigured = isBuilderConfigured();
  const isBuilderApproved = (maxBuilderFee ?? 0) > 0;

  const currentPrice = mids?.[selectedMarket] ? parseFloat(mids[selectedMarket]) : undefined;
  const spotUsdcBalance = parseFloat(
    spotData?.balances?.find((balance: any) => balance.coin === 'USDC')?.total ?? '0',
  ) || 0;

  const selectedPerpMarket = markets?.perp?.find((market: any) => market.name === selectedMarket);
  const maxLeverage = selectedPerpMarket?.maxLeverage || 50;

  const allMarkets: AnyMarket[] = useMemo(() => [
    ...(markets?.spot || []).map((market: any) => ({ ...market, type: 'spot' as const })),
    ...(markets?.perp || []).map((market: any) => ({ ...market, type: 'perp' as const })),
  ], [markets]);

  const priceChanges: Record<string, number> = {};
  const spotTokenNames = markets?.spotTokenNames;
  const enrichedMarkets = useMemo(
    () => enrichMarkets(allMarkets, priceChanges, spotTokenNames),
    [allMarkets, spotTokenNames],
  );

  const isSpotMarket = enrichedMarkets.find(
    (enrichedMarket) => enrichedMarket.market.name === selectedMarket,
  )?.market.type === 'spot';

  const prices: Record<string, string> = {};
  if (mids) {
    Object.entries(mids).forEach(([coin, price]) => {
      prices[coin] = String(price);
    });
  }

  const tradingBlockedByBuilder = authenticated && builderConfigured && !isApprovalLoading && !isBuilderApproved;
  const tradingMutation = isSpotMarket ? placeSpotOrder : placeOrder;

  const submitOrder = (order: Order) => {
    if (isSpotMarket) {
      placeSpotOrder.mutate({
        ...order,
        marketType: 'spot',
      });
      return;
    }

    placeOrder.mutate({
      ...order,
      marketType: 'perp',
    });
  };

  const handlePlaceOrder = (order: Order) => {
    if (isApprovalLoading) return;
    if (tradingBlockedByBuilder) {
      haptics.warning();
      return;
    }

    haptics.medium();
    submitOrder(order);
  };

  const handlePriceClick = (price: number) => {
    console.log('Price clicked:', price);
  };

  const handleApproveBuilder = async () => {
    try {
      haptics.medium();
      await approveBuilder.mutateAsync();
      haptics.success();
    } catch {
      haptics.error();
    }
  };

  return (
    <div className="p-4 space-y-4">
      <MarketSelector
        markets={enrichedMarkets}
        selectedMarket={selectedMarket}
        onSelectMarket={setSelectedMarket}
        prices={prices}
        priceChanges={priceChanges}
        categories={CATEGORY_ORDER}
        categoryLabels={CATEGORY_LABELS}
      />

      <Card>
        <Chart
          candles={candles || []}
          interval={interval}
          onIntervalChange={setInterval}
          currentPrice={currentPrice}
        />
      </Card>

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

      {authenticated && builderConfigured && (
        <Card>
          <div className="space-y-3">
            <h3 className={`font-semibold ${isBuilderApproved ? 'text-green-400' : 'text-yellow-400'}`}>
              {isBuilderApproved ? 'Builder Fee Approved' : 'Builder Fee Approval Required'}
            </h3>
            <p className="text-sm text-gray-400">
              {isBuilderApproved
                ? 'This wallet is already approved for the configured builder fee. Trading is unlocked.'
                : 'Trading is locked until you approve the configured builder fee once for this wallet.'}
            </p>
            {!isBuilderApproved && (
              <button
                onClick={handleApproveBuilder}
                disabled={approveBuilder.isPending}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg font-medium transition-colors text-sm"
              >
                {approveBuilder.isPending ? 'Approving...' : 'Approve Builder Fee'}
              </button>
            )}
            {approveBuilder.isError && (
              <p className="text-sm text-red-400">
                {approveBuilder.error instanceof Error ? approveBuilder.error.message : 'Approval failed'}
              </p>
            )}
          </div>
        </Card>
      )}

      <Card title="Place Order">
        {tradingBlockedByBuilder ? (
          <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/20 p-4 text-sm text-yellow-200">
            Approve the builder fee above to unlock order placement for this wallet.
          </div>
        ) : (
          <OrderForm
            coin={selectedMarket}
            currentPrice={currentPrice}
            maxLeverage={isSpotMarket ? 1 : maxLeverage}
            availableBalance={isSpotMarket ? spotUsdcBalance : (userState?.marginSummary?.accountValue || 0)}
            isSpot={isSpotMarket}
            onPlaceOrder={handlePlaceOrder}
            isLoading={placeOrder.isPending || placeSpotOrder.isPending || approveBuilder.isPending || isApprovalLoading}
          />
        )}
        {tradingMutation.isSuccess && !tradingBlockedByBuilder && (
          <p className="mt-3 text-center text-sm text-green-400">Order placed successfully.</p>
        )}
        {tradingMutation.isError && (
          <p className="mt-3 text-center text-sm text-red-400">
            {tradingMutation.error instanceof Error ? tradingMutation.error.message : 'Order failed — please try again'}
          </p>
        )}
      </Card>
    </div>
  );
}
