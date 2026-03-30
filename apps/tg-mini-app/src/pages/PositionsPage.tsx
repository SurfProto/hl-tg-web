import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useUserState,
  useOpenOrders,
  useFills,
  useCancelOrder,
  useClosePosition,
  useMids,
} from '@repo/hyperliquid-sdk';
import { TokenIcon } from '../components/TokenIcon';
import { useHaptics } from '../hooks/useHaptics';

function formatUsd(value: number) {
  return `$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function PositionsEmptyState() {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-separator bg-white p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface">
        <svg className="h-7 w-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
        </svg>
      </div>
      <p className="text-base font-semibold text-foreground">No open positions</p>
      <p className="mt-1 text-sm text-muted">Your active trades, orders, and fills will appear here.</p>
      <button
        onClick={() => navigate('/')}
        className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors"
      >
        Start trading
      </button>
    </div>
  );
}

export function PositionsPage() {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'fills'>('positions');

  const { data: userState } = useUserState();
  const { data: openOrders } = useOpenOrders();
  const { data: fills } = useFills();
  const { data: mids } = useMids();
  const cancelOrder = useCancelOrder();
  const closePosition = useClosePosition();

  const positions = useMemo(
    () => (userState?.assetPositions?.map((assetPosition: any) => assetPosition.position) ?? []).filter((p: any) => p.szi !== 0),
    [userState?.assetPositions],
  );

  return (
    <div className="min-h-full bg-background px-4 py-5">
      <div className="mb-5 flex rounded-full bg-surface p-1">
        {([
          { key: 'positions', label: `Positions (${positions.length})` },
          { key: 'orders', label: `Orders (${openOrders?.length ?? 0})` },
          { key: 'fills', label: 'Fills' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              haptics.selection();
              setActiveTab(key);
            }}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === key ? 'bg-primary text-white' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'positions' && (
        <div className="space-y-3">
          {positions.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            positions.map((position: any) => {
              const currentPrice = mids?.[position.coin] ? parseFloat(mids[position.coin]) : position.entryPx;
              const pnl = position.unrealizedPnl ?? 0;
              const isPositive = pnl >= 0;
              const isLong = position.szi > 0;
              const displayName = position.coin.includes(':') ? position.coin.split(':')[1] : position.coin;

              return (
                <div
                  key={position.coin}
                  onClick={() => navigate(`/coin/${encodeURIComponent(position.coin)}`)}
                  className="rounded-2xl border border-separator bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenIcon coin={displayName.split('/')[0]} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-foreground">{displayName}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isLong ? 'bg-blue-50 text-primary' : 'bg-gray-100 text-gray-700'}`}>
                            {isLong ? 'Long' : 'Short'}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {Math.abs(position.szi).toFixed(4)} @ ${position.entryPx.toFixed(4)}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className={`text-sm font-semibold ${isPositive ? 'text-positive' : 'text-negative'}`}>
                        {isPositive ? '+' : '-'}{formatUsd(pnl)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Mark ${currentPrice.toFixed(4)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-surface px-3 py-2">
                      <p className="text-xs text-muted">Position value</p>
                      <p className="mt-1 font-semibold text-foreground">{formatUsd(position.positionValue ?? 0)}</p>
                    </div>
                    <div className="rounded-xl bg-surface px-3 py-2">
                      <p className="text-xs text-muted">Leverage</p>
                      <p className="mt-1 font-semibold text-foreground">
                        {position.leverage.value}x {position.leverage.type}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        haptics.medium();
                        closePosition.mutate(position.coin);
                      }}
                      className="flex-1 rounded-full bg-[#111827] px-4 py-3 text-sm font-semibold text-white active:opacity-80 transition-opacity"
                    >
                      {closePosition.isPending ? 'Closing...' : 'Close'}
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/trade/${encodeURIComponent(position.coin)}?side=${isLong ? 'short' : 'long'}`);
                      }}
                      className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors"
                    >
                      Trade more
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="space-y-3">
          {!openOrders || openOrders.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            openOrders.map((order: any) => (
              <div key={order.oid} className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{order.coin}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${order.side === 'buy' ? 'bg-blue-50 text-primary' : 'bg-gray-100 text-gray-700'}`}>
                        {order.side === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {order.sz} {order.orderType === 'limit' ? `@ $${order.limitPx}` : 'market order'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      haptics.medium();
                      cancelOrder.mutate({ coin: order.coin, oid: order.oid });
                    }}
                    className="rounded-full bg-red-50 px-4 py-2 text-sm font-semibold text-negative active:bg-red-100 transition-colors"
                  >
                    {cancelOrder.isPending ? 'Canceling...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'fills' && (
        <div className="space-y-3">
          {!fills || fills.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            fills.slice(0, 20).map((fill: any, index: number) => {
              const isPositive = fill.closedPnl >= 0;
              return (
                <div key={`${fill.hash}-${index}`} className="rounded-2xl border border-separator bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{fill.coin}</p>
                      <p className="mt-1 text-sm text-muted">
                        {fill.side === 'buy' ? 'Bought' : 'Sold'} {fill.sz} @ ${fill.px}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${isPositive ? 'text-positive' : 'text-negative'}`}>
                        {isPositive ? '+' : ''}{fill.closedPnl.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-muted">Fee ${fill.fee.toFixed(4)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
