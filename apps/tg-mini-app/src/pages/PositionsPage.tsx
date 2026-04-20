import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useUserState,
  useOpenOrders,
  useFills,
  useCancelOrder,
  useClosePosition,
  useMarketPrice,
  useUpsertPositionProtection,
} from "@repo/hyperliquid-sdk";
import type { OpenOrder } from "@repo/types";
import { ProtectionSheet } from "../components/ProtectionSheet";
import { TokenIcon } from "../components/TokenIcon";
import { getAsyncValueState } from "../lib/async-value-state";
import { useHaptics } from "../hooks/useHaptics";
import { useToast } from "../hooks/useToast";
import {
  EMPTY_PROTECTION_DRAFT,
  classifyProtectionOrder,
  createProtectionDraft,
  getProtectionState,
  parseProtectionPrice,
  type PositionDirection,
  type ProtectionDraft,
} from "../lib/protection";
import { formatPrice } from "../utils/format";

function formatUsd(value: number) {
  return `$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatPnl(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

interface EditingProtectionState {
  coin: string;
  direction: PositionDirection;
  displayName: string;
  currentPrice: number | null;
  entryPrice: number;
  size: number;
  draft: ProtectionDraft;
}

interface PositionCardProps {
  position: any;
  openOrders: OpenOrder[];
  pendingCloseCoin: string | null;
  onEditProtection: (state: EditingProtectionState) => void;
  onClosePosition: (coin: string, displayName: string) => void;
  onTradeMore: (coin: string, side: "long" | "short") => void;
}

function PositionCard({
  position,
  openOrders,
  pendingCloseCoin,
  onEditProtection,
  onClosePosition,
  onTradeMore,
}: PositionCardProps) {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const { t } = useTranslation();
  const { data: currentPrice, isError, isLoading } = useMarketPrice(position.coin);
  const priceState = getAsyncValueState({
    hasValue: currentPrice != null,
    isLoading,
    isError,
  });
  const pnl = position.unrealizedPnl ?? 0;
  const pnlPercent = position.returnOnEquity ? position.returnOnEquity * 100 : 0;
  const isPositive = pnl >= 0;
  const isLong = position.szi > 0;
  const direction: PositionDirection = isLong ? "long" : "short";
  const displayName = position.coin.includes(":")
    ? position.coin.split(":")[1]
    : position.coin;
  const protectionOrders = openOrders.filter(
    (order: OpenOrder) =>
      order.coin === position.coin && order.isTrigger && order.reduceOnly,
  );
  const protectionState = getProtectionState(
    protectionOrders,
    direction,
    currentPrice ?? null,
    position.szi,
  );

  return (
    <div
      onClick={() => navigate(`/coin/${encodeURIComponent(position.coin)}`)}
      className="rounded-2xl border border-separator bg-white p-4"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <TokenIcon coin={displayName.split("/")[0]} size={32} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">{displayName}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                  isLong
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary/10 text-secondary"
                }`}
              >
                {isLong ? t("common.long") : t("common.short")} · {position.leverage?.value ?? 1}×
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 font-mono">
              {Math.abs(position.szi)} @ {formatPrice(position.entryPx)}
            </div>
          </div>
        </div>
        
        {/* PnL */}
        <div className="text-right">
          <div className={`text-lg font-bold font-mono ${isPositive ? "text-positive" : "text-negative"}`}>
            {formatPnl(pnl)}
          </div>
          <div className={`text-xs font-medium ${isPositive ? "text-positive" : "text-negative"}`}>
            {formatPercent(pnlPercent)}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="flex items-center justify-between text-xs text-muted mb-4">
        <div className="flex gap-4">
          <span>
            {t("positions.margin")}: <span className="text-foreground font-medium font-mono">{formatUsd(position.marginUsed ?? 0)}</span>
          </span>
        </div>
        <span>
          {t("positions.markPrice")}: <span className="text-foreground font-medium font-mono">
            {priceState === "ready" ? formatPrice(currentPrice!) : "..."}
          </span>
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            haptics.light();
            onEditProtection({
              coin: position.coin,
              direction,
              displayName,
              currentPrice: currentPrice ?? null,
              entryPrice: position.entryPx,
              size: Math.abs(position.szi),
              draft: createProtectionDraft(
                protectionState.stopLoss?.triggerPx ?? null,
                protectionState.takeProfit?.triggerPx ?? null,
              ),
            });
          }}
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-surface text-xs font-semibold text-foreground transition-colors active:bg-gray-200"
        >
          TP/SL
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            haptics.light();
            onTradeMore(position.coin, isLong ? "long" : "short");
          }}
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-surface text-xs font-semibold text-foreground transition-colors active:bg-gray-200"
        >
          {t("positions.addMargin")}
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            haptics.medium();
            onClosePosition(position.coin, displayName);
          }}
          disabled={pendingCloseCoin === position.coin}
          className="flex-1 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
        >
          {pendingCloseCoin === position.coin
            ? t("common.closing")
            : t("common.close")}
        </button>
      </div>
    </div>
  );
}

interface OpenOrderCardProps {
  order: any;
  linkedPosition?: any;
  pendingCancelOid: number | null;
  onCancel: (order: any) => void;
}

function OpenOrderCard({
  order,
  linkedPosition,
  pendingCancelOid,
  onCancel,
}: OpenOrderCardProps) {
  const haptics = useHaptics();
  const { t } = useTranslation();
  const { data: orderCurrentPrice, isError, isLoading } = useMarketPrice(order.coin);
  const priceState = getAsyncValueState({
    hasValue: orderCurrentPrice != null,
    isLoading,
    isError,
  });
  const orderCoin = order.coin.includes(":")
    ? order.coin.split(":")[1]
    : order.coin;
  const orderDirection: PositionDirection | null = linkedPosition
    ? linkedPosition.szi > 0
      ? "long"
      : "short"
    : null;
  const protectionKind = orderDirection
    ? classifyProtectionOrder(
        order as OpenOrder,
        orderDirection,
        priceState === "ready" ? (orderCurrentPrice ?? null) : null,
      )
    : null;
  const orderBadgeLabel =
    protectionKind === "stopLoss"
      ? "SL"
      : protectionKind === "takeProfit"
        ? "TP"
        : order.side === "buy"
          ? t("coinDetail.buyButton")
          : t("coinDetail.sellButton");

  return (
    <div className="rounded-2xl border border-separator bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <TokenIcon coin={orderCoin.split("/")[0]} size={32} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">{orderCoin}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  protectionKind === "stopLoss"
                    ? "bg-negative/10 text-negative"
                    : protectionKind === "takeProfit"
                      ? "bg-positive/10 text-positive"
                      : order.side === "buy"
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary/10 text-secondary"
                }`}
              >
                {orderBadgeLabel}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 font-mono">
              {order.sz} @ {protectionKind && order.triggerPx != null
                ? formatPrice(order.triggerPx)
                : order.limitPx
                  ? formatPrice(order.limitPx)
                  : "Market"}
            </div>
          </div>
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            haptics.medium();
            onCancel(order);
          }}
          disabled={pendingCancelOid === order.oid}
          className="rounded-lg bg-negative/10 px-3 py-2 text-xs font-semibold text-negative transition-colors active:bg-negative/20 disabled:opacity-50"
        >
          {pendingCancelOid === order.oid
            ? t("common.canceling")
            : t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function PositionsEmptyState() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-separator bg-white p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface">
        <svg
          className="h-7 w-7 text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2"
          />
        </svg>
      </div>
      <p className="text-base font-semibold text-foreground">
        {t("positions.emptyTitle")}
      </p>
      <p className="mt-1 text-sm text-muted">
        {t("positions.emptySubtitle")}
      </p>
      <button
        onClick={() => navigate("/")}
        className="mt-5 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark"
      >
        {t("positions.startTrading")}
      </button>
    </div>
  );
}

export function PositionsPage() {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const toast = useToast();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "fills">(
    "positions",
  );
  const [editingProtection, setEditingProtection] =
    useState<EditingProtectionState | null>(null);
  const [pendingCloseCoin, setPendingCloseCoin] = useState<string | null>(null);
  const [pendingCancelOid, setPendingCancelOid] = useState<number | null>(null);

  const { data: userState } = useUserState();
  const { data: openOrders } = useOpenOrders();
  const { data: fills } = useFills();
  const cancelOrder = useCancelOrder();
  const closePosition = useClosePosition();
  const upsertPositionProtection = useUpsertPositionProtection();

  const positions = useMemo(
    () =>
      (
        userState?.assetPositions?.map(
          (assetPosition: any) => assetPosition.position,
        ) ?? []
      ).filter((position: any) => position.szi !== 0),
    [userState?.assetPositions],
  );

  const positionsByCoin = useMemo(
    () => new Map(positions.map((position: any) => [position.coin, position])),
    [positions],
  );

  // Calculate total unrealized PnL and margin
  const totalUnrealizedPnl = useMemo(
    () => positions.reduce((sum: number, pos: any) => sum + (pos.unrealizedPnl ?? 0), 0),
    [positions],
  );

  const totalMargin = useMemo(
    () => positions.reduce((sum: number, pos: any) => sum + (pos.marginUsed ?? 0), 0),
    [positions],
  );

  const handleProtectionSave = async () => {
    if (!editingProtection) return;

    try {
      await upsertPositionProtection.mutateAsync({
        coin: editingProtection.coin,
        stopLossPx: editingProtection.draft.stopLossEnabled
          ? parseProtectionPrice(editingProtection.draft.stopLossPx)
          : null,
        takeProfitPx: editingProtection.draft.takeProfitEnabled
          ? parseProtectionPrice(editingProtection.draft.takeProfitPx)
          : null,
      });
      haptics.success();
      toast.success(t("positions.protectionUpdated"));
      setEditingProtection(null);
    } catch (error) {
      haptics.error();
      toast.error(
        error instanceof Error ? error.message : t("positions.protectionUpdateFailed"),
      );
    }
  };

  return (
    <div className="min-h-full bg-background px-4 py-5">
      {/* Header with Summary */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-foreground">{t("nav.positions")}</h1>
        {positions.length > 0 && (
          <div className="mt-3 flex gap-6">
            <div>
              <div className="text-xs text-muted uppercase tracking-wide">{t("positions.unrealizedPnl")}</div>
              <div className={`text-xl font-bold font-mono ${totalUnrealizedPnl >= 0 ? "text-positive" : "text-negative"}`}>
                {formatPnl(totalUnrealizedPnl)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted uppercase tracking-wide">{t("positions.margin")}</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {formatUsd(totalMargin)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tab Bar */}
      <div className="mb-5 flex gap-1 rounded-xl bg-surface p-1">
        {(
          [
            { key: "positions", label: `${t("positions.tabOpen")} · ${positions.length}` },
            { key: "orders", label: `${t("positions.tabOrders")} · ${openOrders?.length ?? 0}` },
            { key: "fills", label: t("positions.tabHistory") },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              haptics.selection();
              setActiveTab(key);
            }}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === key
                ? "bg-white text-foreground shadow-sm"
                : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "positions" && (
        <div className="space-y-3">
          {positions.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            positions.map((position: any) => (
              <PositionCard
                key={position.coin}
                position={position}
                openOrders={openOrders ?? []}
                pendingCloseCoin={pendingCloseCoin}
                onEditProtection={setEditingProtection}
                onClosePosition={(coin, displayName) => {
                  setPendingCloseCoin(coin);
                  closePosition.mutate(coin, {
                    onSuccess: () => {
                      setPendingCloseCoin(null);
                      haptics.success();
                      toast.success(t("positions.positionClosed", { name: displayName }));
                    },
                    onError: (error) => {
                      setPendingCloseCoin(null);
                      haptics.error();
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("positions.closeFailed"),
                      );
                    },
                  });
                }}
                onTradeMore={(coin, tradeSide) => {
                  navigate(`/trade/${encodeURIComponent(coin)}?side=${tradeSide}`);
                }}
              />
            ))
          )}
        </div>
      )}

      {activeTab === "orders" && (
        <div className="space-y-3">
          {!openOrders || openOrders.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            openOrders.map((order: any) => (
              <OpenOrderCard
                key={order.oid}
                order={order}
                linkedPosition={positionsByCoin.get(order.coin)}
                pendingCancelOid={pendingCancelOid}
                onCancel={(targetOrder) => {
                  setPendingCancelOid(targetOrder.oid);
                  cancelOrder.mutate(
                    { coin: targetOrder.coin, oid: targetOrder.oid },
                    {
                      onSuccess: () => {
                        setPendingCancelOid(null);
                        haptics.success();
                        toast.success(t("positions.orderCancelled"));
                      },
                      onError: (error) => {
                        setPendingCancelOid(null);
                        haptics.error();
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : t("positions.cancelFailed"),
                        );
                      },
                    },
                  );
                }}
              />
            ))
          )}
        </div>
      )}

      {activeTab === "fills" && (
        <div className="space-y-3">
          {!fills || fills.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            fills.slice(0, 20).map((fill: any, index: number) => {
              const isPositive = fill.closedPnl >= 0;
              return (
                <div
                  key={`${fill.hash}-${index}`}
                  className="rounded-2xl border border-separator bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <TokenIcon coin={fill.coin.split("/")[0]} size={32} />
                      <div>
                        <p className="font-bold text-foreground">
                          {fill.coin}
                        </p>
                        <p className="text-xs text-muted mt-0.5 font-mono">
                          {fill.side === "buy" ? t("positions.bought") : t("positions.sold")} {fill.sz} @ $
                          {fill.px}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-bold font-mono ${isPositive ? "text-positive" : "text-negative"}`}
                      >
                        {isPositive ? "+" : ""}${fill.closedPnl.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        {t("positions.fee")} ${fill.fee.toFixed(4)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <ProtectionSheet
        isOpen={editingProtection != null}
        onClose={() => setEditingProtection(null)}
        onSubmit={handleProtectionSave}
        draft={editingProtection?.draft ?? EMPTY_PROTECTION_DRAFT}
        onChange={(draft) => {
          setEditingProtection((previous) => {
            if (!previous) return previous;
            return { ...previous, draft };
          });
        }}
        direction={editingProtection?.direction ?? "long"}
        marketLabel={editingProtection?.displayName ?? t("positions.positionLabel")}
        currentPrice={editingProtection?.currentPrice ?? null}
        referencePrice={editingProtection?.entryPrice ?? null}
        size={editingProtection?.size ?? 0}
        submitLabel={t("positions.saveProtection")}
        isSubmitting={upsertPositionProtection.isPending}
      />
    </div>
  );
}
