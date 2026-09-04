import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useUserState,
  useOpenOrders,
  useFills,
  useCancelAllOrders,
  useCancelOrder,
  useModifyOrder,
  useClosePosition,
  useHistoricalOrders,
  useMarketPrice,
  useUpsertPositionProtection,
  useUserFunding,
} from "@repo/hyperliquid-sdk";
import type { FundingPayment, HistoricalOrder, OpenOrder } from "@repo/types";
import { ProtectionSheet } from "../components/ProtectionSheet";
import { SegmentedControl } from "../components/SegmentedControl";
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
import {
  formatPercent,
  formatPnl,
  formatPositionSize,
  formatUsd,
  formatUsdPrice,
} from "../utils/format";
import { stripDexPrefix } from "../lib/market-symbol";

// The exchange's status words, in the user's language. An unmapped status
// falls back to the raw word — honest, if unpolished, for the long tail
// (liquidations, sibling-order cancels).
const ORDER_STATUS_KEYS: Record<string, string> = {
  canceled: "positions.orderStatusCanceled",
  filled: "positions.orderStatusFilled",
  marginCanceled: "positions.orderStatusMarginCanceled",
  open: "positions.orderStatusOpen",
  rejected: "positions.orderStatusRejected",
  triggered: "positions.orderStatusTriggered",
};

function orderStatusColor(status: string): string {
  if (status === "filled") return "text-positive";
  if (status === "rejected" || status === "marginCanceled") return "text-negative";
  if (status === "canceled") return "text-muted";
  return "text-foreground";
}

/**
 * A fill's moment, in the viewer's locale: time of day for today, date and
 * time otherwise. The history rows carried no timestamp at all.
 */
function formatFillTime(timeMs: number, locale: string): string {
  const date = new Date(timeMs);
  const time = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date.toDateString() === new Date().toDateString()) {
    return time;
  }
  return `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
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
  // Close asks once before firing. A market close of a leveraged position is
  // the most consequential single tap in the app, it sat 8px from two benign
  // buttons on a card that is itself tappable, and it fired immediately —
  // while lesser actions (agent revocation, cancel-all) already confirm.
  const [confirmingClose, setConfirmingClose] = useState(false);
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
  const displayName = stripDexPrefix(position.coin);
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
      className="overflow-hidden rounded-[18px] border border-border bg-white p-4 transition-colors active:bg-surface"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <TokenIcon coin={displayName.split("/")[0]} size={32} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">{displayName}</span>
              {/* Never wraps. "LONG · 10×" broke across two lines inside the
                  pill on a narrow screen, which read as a rendering fault. */}
              <span
                className={`editorial-kicker whitespace-nowrap rounded-full px-2 py-1 ${
                  isLong
                    ? "bg-positive/10 text-positive"
                    : "bg-negative/10 text-negative"
                }`}
              >
                {isLong ? t("common.long") : t("common.short")} · {position.leverage?.value ?? 1}×
              </span>
            </div>
            <div className="editorial-mono mt-1 text-xs text-muted">
              {formatPositionSize(Math.abs(position.szi))} @ {formatUsdPrice(position.entryPx)}
            </div>
          </div>
        </div>
        
        {/* PnL */}
        <div className="text-right">
          {/* The minus sign was breaking onto its own line above the number,
              so a loss rendered as a stray "−" with "$2.11" beneath it. */}
          <div className={`editorial-mono whitespace-nowrap text-lg font-bold ${isPositive ? "text-positive" : "text-negative"}`}>
            {formatPnl(pnl)}
          </div>
          <div className={`text-xs font-medium ${isPositive ? "text-positive" : "text-negative"}`}>
            {formatPercent(pnlPercent)}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="mb-4 flex items-center justify-between text-xs text-muted">
        <div className="flex gap-4">
          <span>
            <span className="editorial-kicker">{t("positions.margin")}</span>{" "}
            <span className="editorial-mono text-foreground font-medium">{formatUsd(position.marginUsed ?? 0)}</span>
          </span>
        </div>
        <span>
          <span className="editorial-kicker">{t("positions.markPrice")}</span>{" "}
          <span className="editorial-mono text-foreground font-medium">
            {priceState === "ready" ? formatUsdPrice(currentPrice!) : "..."}
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
          className="flex-shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground transition-colors active:bg-[var(--color-primary-soft-strong)]"
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
          className="flex-shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground transition-colors active:bg-[var(--color-primary-soft-strong)]"
        >
          {/* It says what it does. This was labelled "Add margin", but it calls
              onTradeMore, which opens the trade screen on the same side — that
              adds exposure at the same leverage and moves the liquidation price
              the wrong way. It is the control someone reaches for when isolated
              margin gets thin, and it did the opposite. Real add-margin needs
              updateIsolatedMargin and an amount input; that is a feature, this
              is stopping the button lying. */}
          {t("positions.addToPosition")}
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            haptics.medium();
            setConfirmingClose(true);
          }}
          disabled={pendingCloseCoin === position.coin}
          className="flex-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
        >
          {pendingCloseCoin === position.coin
            ? t("common.closing")
            : t("common.close")}
        </button>
      </div>

      {confirmingClose && (
        <div
          className="mt-3 border-t border-separator pt-3"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-sm text-foreground">
            {t("positions.closeConfirmBody", {
              size: Math.abs(position.szi),
              name: displayName,
              side: isLong ? t("common.long") : t("common.short"),
            })}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                haptics.light();
                setConfirmingClose(false);
              }}
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                haptics.medium();
                setConfirmingClose(false);
                onClosePosition(position.coin, displayName);
              }}
              className="flex-1 rounded-lg bg-negative px-4 py-2 text-xs font-semibold text-white transition-opacity active:opacity-80"
            >
              {t("positions.confirmClose")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface OpenOrderCardProps {
  order: any;
  linkedPosition?: any;
  pendingCancelOid: number | null;
  pendingModifyOid: number | null;
  onCancel: (order: any) => void;
  onModify: (order: any, newPrice: number) => void;
}

function OpenOrderCard({
  order,
  linkedPosition,
  pendingCancelOid,
  pendingModifyOid,
  onCancel,
  onModify,
}: OpenOrderCardProps) {
  const haptics = useHaptics();
  const { t } = useTranslation();
  // null = editor closed; a string = the price being typed.
  const [draftPrice, setDraftPrice] = useState<string | null>(null);
  const { data: orderCurrentPrice, isError, isLoading } = useMarketPrice(order.coin);
  const priceState = getAsyncValueState({
    hasValue: orderCurrentPrice != null,
    isLoading,
    isError,
  });
  const orderCoin = stripDexPrefix(order.coin);
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
    <div className="rounded-[18px] border border-separator bg-white p-4">
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
                        ? "bg-positive/10 text-positive"
                        : "bg-negative/10 text-negative"
                }`}
              >
                {orderBadgeLabel}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 font-mono">
              {order.sz} @ {protectionKind && order.triggerPx != null
                ? formatUsdPrice(order.triggerPx)
                : order.limitPx
                  ? formatUsdPrice(order.limitPx)
                  : "Market"}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Only a resting limit order has a price worth editing: a trigger
              order's meaningful number is its trigger, managed in the
              protection sheet. */}
          {!order.isTrigger && order.limitPx ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                haptics.light();
                setDraftPrice((open) =>
                  open === null ? String(order.limitPx) : null,
                );
              }}
              disabled={pendingModifyOid === order.oid}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground transition-colors active:bg-[var(--color-primary-soft-strong)] disabled:opacity-50"
            >
              {t("common.edit")}
            </button>
          ) : null}
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

      {draftPrice !== null && (
        <div className="mt-3 flex items-center gap-2 border-t border-separator pt-3">
          <label htmlFor={`edit-price-${order.oid}`} className="editorial-kicker flex-shrink-0">
            {t("positions.limitPrice")}
          </label>
          <input
            id={`edit-price-${order.oid}`}
            type="number"
            inputMode="decimal"
            autoComplete="off"
            value={draftPrice}
            onChange={(event) => setDraftPrice(event.target.value)}
            className="editorial-mono min-w-0 flex-1 rounded-lg border border-separator bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              const newPrice = parseFloat(draftPrice);
              if (!Number.isFinite(newPrice) || newPrice <= 0) return;
              haptics.medium();
              setDraftPrice(null);
              onModify(order, newPrice);
            }}
            disabled={
              pendingModifyOid === order.oid ||
              !(parseFloat(draftPrice) > 0) ||
              parseFloat(draftPrice) === order.limitPx
            }
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
          >
            {pendingModifyOid === order.oid
              ? t("common.saving")
              : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
}

function PositionsEmptyState() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="rounded-[18px] border border-separator bg-white p-10 text-center">
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
        className="mt-5 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark"
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
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "fills">(
    "positions",
  );
  const [visibleFills, setVisibleFills] = useState(20);
  const [historyView, setHistoryView] = useState<"fills" | "orders" | "funding">("fills");
  const [visibleFunding, setVisibleFunding] = useState(20);
  const [visibleOrders, setVisibleOrders] = useState(20);
  const [editingProtection, setEditingProtection] =
    useState<EditingProtectionState | null>(null);
  const [pendingCloseCoin, setPendingCloseCoin] = useState<string | null>(null);
  const [pendingCancelOid, setPendingCancelOid] = useState<number | null>(null);

  const { data: userState } = useUserState();
  const { data: openOrders } = useOpenOrders();
  const { data: fills } = useFills();
  const { data: historicalOrders } = useHistoricalOrders();
  const { data: fundingPayments } = useUserFunding();

  // Net realized outcome over the fills the exchange still retains: closed
  // PnL minus every fee paid. "Recent" in the label is load-bearing — this is
  // a window, not a lifetime total.
  const realizedRecentUsd = useMemo(
    () =>
      (fills ?? []).reduce(
        (sum: number, fill: any) => sum + (fill.closedPnl ?? 0) - (fill.fee ?? 0),
        0,
      ),
    [fills],
  );
  const cancelOrder = useCancelOrder();
  const cancelAllOrders = useCancelAllOrders();
  const modifyOrder = useModifyOrder();
  const [pendingModifyOid, setPendingModifyOid] = useState<number | null>(null);
  // Cancel-all takes two taps: the first arms it for a few seconds, the
  // second fires. Same reasoning as everywhere else money moves in one tap —
  // a mis-tap must not be able to sweep every resting order.
  const [cancelAllArmed, setCancelAllArmed] = useState(false);
  const cancelAllDisarmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    <div className="editorial-page px-4 py-5">
      <div className="mb-5">
        <h1 className="editorial-heading text-foreground">{t("nav.positions")}</h1>
        {positions.length > 0 && (
          <div className="mt-4 flex gap-6 rounded-[18px] bg-primary px-4 py-4 text-white">
            <div className="flex-1">
              <div className="editorial-kicker text-white/65">{t("positions.unrealizedPnl")}</div>
              <div className={`editorial-display-sm mt-2 ${totalUnrealizedPnl >= 0 ? "text-signal" : "text-white"}`}>
                {formatPnl(totalUnrealizedPnl)}
              </div>
            </div>
            <div className="flex-1 text-right">
              <div className="editorial-kicker text-white/65">{t("positions.margin")}</div>
              <div className="editorial-display-sm mt-2 text-white">
                {formatUsd(totalMargin)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tab Bar */}
      <div className="mb-5">
        <SegmentedControl
          label={t("nav.positions")}
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: "positions", label: `${t("positions.tabOpen")} · ${positions.length}` },
            { value: "orders", label: `${t("positions.tabOrders")} · ${openOrders?.length ?? 0}` },
            { value: "fills", label: t("positions.tabHistory") },
          ]}
        />
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
          {openOrders && openOrders.length > 1 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!cancelAllArmed) {
                    haptics.light();
                    setCancelAllArmed(true);
                    if (cancelAllDisarmRef.current) {
                      clearTimeout(cancelAllDisarmRef.current);
                    }
                    cancelAllDisarmRef.current = setTimeout(
                      () => setCancelAllArmed(false),
                      4000,
                    );
                    return;
                  }
                  haptics.medium();
                  setCancelAllArmed(false);
                  cancelAllOrders.mutate(undefined, {
                    onSuccess: () => {
                      haptics.success();
                      toast.success(t("positions.allOrdersCancelled"));
                    },
                    onError: (error) => {
                      haptics.error();
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("positions.cancelFailed"),
                      );
                    },
                  });
                }}
                disabled={cancelAllOrders.isPending}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  cancelAllArmed
                    ? "bg-negative text-white"
                    : "bg-negative/10 text-negative active:bg-negative/20"
                }`}
              >
                {cancelAllOrders.isPending
                  ? t("common.canceling")
                  : cancelAllArmed
                    ? t("positions.cancelAllConfirm")
                    : t("positions.cancelAll")}
              </button>
            </div>
          )}
          {!openOrders || openOrders.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            openOrders.map((order: any) => (
              <OpenOrderCard
                key={order.oid}
                order={order}
                linkedPosition={positionsByCoin.get(order.coin)}
                pendingCancelOid={pendingCancelOid}
                pendingModifyOid={pendingModifyOid}
                onModify={(targetOrder, newPrice) => {
                  setPendingModifyOid(targetOrder.oid);
                  modifyOrder.mutate(
                    {
                      oid: targetOrder.oid,
                      order: {
                        coin: targetOrder.coin,
                        side: targetOrder.side,
                        // The exact resting size travels as baseSz; sizeUsd is
                        // still supplied for validation, but the size the
                        // exchange keeps must not change because the price did.
                        sizeUsd: newPrice * targetOrder.sz,
                        baseSz: targetOrder.sz,
                        orderType: "limit",
                        reduceOnly: Boolean(targetOrder.reduceOnly),
                        marketType: "perp",
                        limitPx: newPrice,
                        tif: targetOrder.tif ?? "Gtc",
                      },
                    },
                    {
                      onSuccess: () => {
                        setPendingModifyOid(null);
                        haptics.success();
                        toast.success(t("positions.orderModified"));
                      },
                      onError: (error) => {
                        setPendingModifyOid(null);
                        haptics.error();
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : t("positions.modifyFailed"),
                        );
                      },
                    },
                  );
                }}
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
          {/* Trades first, order statuses one tap away — retail users think
              in trades, not order lifecycles. */}
          <div className="flex gap-2">
            {(["fills", "orders", "funding"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setHistoryView(view)}
                className={`editorial-chip editorial-chip-compact ${
                  historyView === view ? "editorial-chip-active" : ""
                }`}
              >
                {view === "fills"
                  ? t("positions.tabFills")
                  : view === "orders"
                    ? t("positions.tabOrders")
                    : t("positions.tabFunding")}
              </button>
            ))}
          </div>

          {historyView === "funding" ? (
            !fundingPayments || fundingPayments.length === 0 ? (
              <PositionsEmptyState />
            ) : (
              <>
                {fundingPayments.slice(0, visibleFunding).map((payment: FundingPayment) => {
                  const displayName = stripDexPrefix(payment.coin);
                  return (
                    <div
                      key={`${payment.coin}-${payment.time}`}
                      className="rounded-[18px] border border-separator bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <TokenIcon coin={displayName.split("/")[0]} size={32} />
                          <div>
                            <p className="font-bold text-foreground">{displayName}</p>
                            <p className="text-xs text-muted mt-0.5 font-mono">
                              {`${(payment.fundingRate * 100).toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")}%`}
                            </p>
                            <p className="text-xs text-muted mt-0.5">
                              {formatFillTime(payment.time, i18n.language)}
                            </p>
                          </div>
                        </div>
                        <p
                          className={`text-sm font-bold font-mono ${payment.usdc >= 0 ? "text-positive" : "text-negative"}`}
                        >
                          {formatPnl(payment.usdc)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {fundingPayments.length > visibleFunding && (
                  <button
                    type="button"
                    onClick={() => setVisibleFunding((count) => count + 20)}
                    className="w-full rounded-[18px] border border-separator bg-white px-4 py-3 text-sm font-semibold text-primary transition-colors active:bg-surface"
                  >
                    {t("positions.showMore")}
                  </button>
                )}
                <p className="pt-1 text-center text-xs text-muted">
                  {t("positions.recentActivityNote")}
                </p>
              </>
            )
          ) : historyView === "orders" ? (
            !historicalOrders || historicalOrders.length === 0 ? (
              <PositionsEmptyState />
            ) : (
              <>
                {historicalOrders.slice(0, visibleOrders).map((order: HistoricalOrder) => {
                  const displayName = stripDexPrefix(order.coin);
                  const statusKey = ORDER_STATUS_KEYS[order.status];
                  const partiallyFilled =
                    order.filledSz > 0 && order.filledSz < order.origSz;
                  return (
                    <div
                      key={order.oid}
                      className="rounded-[18px] border border-separator bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <TokenIcon coin={displayName.split("/")[0]} size={32} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground">{displayName}</span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  order.side === "buy"
                                    ? "bg-primary/10 text-primary"
                                    : "bg-secondary/10 text-secondary"
                                }`}
                              >
                                {order.side === "buy"
                                  ? t("coinDetail.buyButton")
                                  : t("coinDetail.sellButton")}
                              </span>
                            </div>
                            <p className="text-xs text-muted mt-0.5 font-mono">
                              {partiallyFilled
                                ? `${formatPositionSize(order.filledSz)}/${formatPositionSize(order.origSz)}`
                                : formatPositionSize(order.origSz)}{" "}
                              @{" "}
                              {order.isTrigger && order.triggerPx
                                ? formatUsdPrice(order.triggerPx)
                                : order.limitPx
                                  ? formatUsdPrice(order.limitPx)
                                  : t("trade.orderTypeMarket")}
                            </p>
                            <p className="text-xs text-muted mt-0.5">
                              {formatFillTime(order.statusTimestamp, i18n.language)}
                            </p>
                          </div>
                        </div>
                        <p className={`text-sm font-semibold ${orderStatusColor(order.status)}`}>
                          {statusKey ? t(statusKey) : order.status}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {historicalOrders.length > visibleOrders && (
                  <button
                    type="button"
                    onClick={() => setVisibleOrders((count) => count + 20)}
                    className="w-full rounded-[18px] border border-separator bg-white px-4 py-3 text-sm font-semibold text-primary transition-colors active:bg-surface"
                  >
                    {t("positions.showMore")}
                  </button>
                )}
                <p className="pt-1 text-center text-xs text-muted">
                  {t("positions.recentActivityNote")}
                </p>
              </>
            )
          ) : !fills || fills.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            <>
              {/* The number a history screen is opened for: what trading has
                  actually netted, fees included, over the retained window. */}
              <div className="flex items-center justify-between rounded-[18px] border border-separator bg-white px-4 py-3">
                <span className="editorial-kicker">
                  {t("positions.realizedPnlRecent")}
                </span>
                <span
                  className={`editorial-mono text-sm font-bold ${realizedRecentUsd >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {formatPnl(realizedRecentUsd)}
                </span>
              </div>
              {fills.slice(0, visibleFills).map((fill: any) => {
                // Realized PnL exists only where something was closed. An
                // opening fill used to render "+$0.00" in green — a fabricated
                // win; it shows the trade's notional instead.
                const isClose = fill.dir !== "Open";
                const displayName = stripDexPrefix(fill.coin);
                return (
                  <div
                    key={fill.tid}
                    className="rounded-[18px] border border-separator bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <TokenIcon coin={displayName.split("/")[0]} size={32} />
                        <div>
                          <p className="font-bold text-foreground">
                            {displayName}
                          </p>
                          <p className="text-xs text-muted mt-0.5 font-mono">
                            {fill.side === "buy" ? t("positions.bought") : t("positions.sold")} {fill.sz} @{" "}
                            {formatUsdPrice(fill.px)}
                          </p>
                          <p className="text-xs text-muted mt-0.5">
                            {formatFillTime(fill.time, i18n.language)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {isClose ? (
                          <p
                            className={`text-sm font-bold font-mono ${fill.closedPnl >= 0 ? "text-positive" : "text-negative"}`}
                          >
                            {formatPnl(fill.closedPnl)}
                          </p>
                        ) : (
                          <p className="text-sm font-bold font-mono text-foreground">
                            {formatUsd(fill.px * fill.sz)}
                          </p>
                        )}
                        <p className="text-xs text-muted mt-0.5">
                          {t("positions.fee")} ${fill.fee.toFixed(4)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {fills.length > visibleFills && (
                <button
                  type="button"
                  onClick={() => setVisibleFills((count) => count + 20)}
                  className="w-full rounded-[18px] border border-separator bg-white px-4 py-3 text-sm font-semibold text-primary transition-colors active:bg-surface"
                >
                  {t("positions.showMore")}
                </button>
              )}
              {/* The exchange retains a bounded history; pretending this list
                  is a complete ledger would be a lie of omission. */}
              <p className="pt-1 text-center text-xs text-muted">
                {t("positions.recentActivityNote")}
              </p>
            </>
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
