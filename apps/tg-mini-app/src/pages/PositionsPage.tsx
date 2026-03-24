import React, { useState } from 'react';
import { PositionsTable, Card, Button } from '@repo/ui';
import {
  useUserState,
  useOpenOrders,
  useFills,
  useCancelOrder,
  useMids,
} from '@repo/hyperliquid-sdk';

export function PositionsPage() {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'fills'>('positions');

  // Fetch data
  const { data: userState } = useUserState();
  const { data: openOrders } = useOpenOrders();
  const { data: fills } = useFills();
  const { data: mids } = useMids();
  const cancelOrder = useCancelOrder();

  // Get positions
  const positions = userState?.assetPositions?.map((ap: any) => ap.position) || [];

  // Prepare current prices
  const currentPrices: Record<string, string> = {};
  if (mids) {
    Object.entries(mids).forEach(([coin, price]) => {
      currentPrices[coin] = String(price);
    });
  }

  // Handle close position
  const handleClosePosition = (coin: string) => {
    // Find the position and place a closing order
    const position = positions.find((p: any) => p.coin === coin);
    if (position) {
      // Place a market order in the opposite direction
      console.log('Close position:', coin);
    }
  };

  // Handle cancel order
  const handleCancelOrder = (coin: string, oid: number) => {
    cancelOrder.mutate({ coin, oid });
  };

  return (
    <div className="p-4 space-y-4">
      {/* Tab Selector */}
      <div className="flex space-x-2 bg-gray-900 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('positions')}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'positions'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Positions ({positions.length})
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'orders'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Orders ({openOrders?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('fills')}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'fills'
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Fills
        </button>
      </div>

      {/* Positions Tab */}
      {activeTab === 'positions' && (
        <Card>
          <PositionsTable
            positions={positions}
            currentPrices={currentPrices}
            onClosePosition={handleClosePosition}
            isLoading={cancelOrder.isPending}
          />
        </Card>
      )}

      {/* Open Orders Tab */}
      {activeTab === 'orders' && (
        <Card>
          {!openOrders || openOrders.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-gray-500">No open orders</p>
            </div>
          ) : (
            <div className="space-y-3">
              {openOrders.map((order: any) => (
                <div
                  key={order.oid}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className={`w-2 h-2 rounded-full ${order.side === 'buy' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="font-medium">{order.coin}</span>
                      <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-700 rounded">
                        {order.orderType === 'limit' ? 'LIMIT' : 'MARKET'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1 text-sm text-gray-400">
                      <span>{order.side === 'buy' ? 'Buy' : 'Sell'} {order.sz}</span>
                      {order.limitPx && <span>@ ${order.limitPx}</span>}
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleCancelOrder(order.coin, order.oid)}
                    loading={cancelOrder.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Fills Tab */}
      {activeTab === 'fills' && (
        <Card>
          {!fills || fills.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-500">No fills yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {fills.slice(0, 20).map((fill: any, index: number) => (
                <div
                  key={`${fill.hash}-${index}`}
                  className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className={`w-2 h-2 rounded-full ${fill.side === 'buy' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="font-medium">{fill.coin}</span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1 text-sm text-gray-400">
                      <span>{fill.side === 'buy' ? 'Bought' : 'Sold'} {fill.sz}</span>
                      <span>@ ${fill.px}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${fill.closedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {fill.closedPnl >= 0 ? '+' : ''}{fill.closedPnl.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">
                      Fee: ${fill.fee.toFixed(4)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
