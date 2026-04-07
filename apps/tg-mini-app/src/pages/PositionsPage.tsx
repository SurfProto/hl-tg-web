import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useUserState,
  useOpenOrders,
  useFills,
  useCancelOrder,
  useClosePosition,
  useMids,
  useUpsertPositionProtection,
} from "@repo/hyperliquid-sdk";
import type { OpenOrder } from "@repo/types";
import { ProtectionSheet } from "../components/ProtectionSheet";
import { TokenIcon } from "../components/TokenIcon";
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

interface EditingProtectionState {
  coin: string;
  direction: PositionDirection;
  displayName: string;
  currentPrice: number | null;
  entryPrice: number;
  size: number;
  draft: ProtectionDraft;
}

function PositionsEmptyState() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-separator bg-white p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface">
        <svg
          className="h-7 w-7 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
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
        className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark"
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
  const { data: mids } = useMids();
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
      <div className="mb-5 flex rounded-full bg-surface p-1">
        {(
          [
            { key: "positions", label: `${t("positions.tabPositions")} (${positions.length})` },
            { key: "orders", label: `${t("positions.tabOrders")} (${openOrders?.length ?? 0})` },
            { key: "fills", label: t("positions.tabFills") },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              haptics.selection();
              setActiveTab(key);
            }}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === key ? "bg-primary text-white" : "text-gray-500"
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
            positions.map((position: any) => {
              const currentPrice = mids?.[position.coin]
                ? parseFloat(mids[position.coin])
                : position.entryPx;
              const pnl = position.unrealizedPnl ?? 0;
              const isPositive = pnl >= 0;
              const isLong = position.szi > 0;
              const direction: PositionDirection = isLong ? "long" : "short";
              const displayName = position.coin.includes(":")
                ? position.coin.split(":")[1]
                : position.coin;
              const protectionOrders = (openOrders ?? []).filter(
                (order: OpenOrder) =>
                  order.coin === position.coin &&
                  order.isTrigger &&
                  order.reduceOnly,
              );
              const protectionState = getProtectionState(
                protectionOrders,
                direction,
                currentPrice,
                position.szi,
              );

              return (
                <div
                  key={position.coin}
                  onClick={() =>
                    navigate(`/coin/${encodeURIComponent(position.coin)}`)
                  }
                  className="rounded-2xl border border-separator bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenIcon coin={displayName.split("/")[0]} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-foreground">
                            {displayName}
                          </p>
                          <span
                            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isLong
                                ? "bg-blue-50 text-primary"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {isLong ? t("common.long") : t("common.short")}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {Math.abs(position.szi)} @{" "}
                          {formatPrice(position.entryPx)}
                        </p>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <p
                        className={`text-sm font-semibold ${isPositive ? "text-positive" : "text-negative"}`}
                      >
                        {isPositive ? "+" : "-"}
                        {formatUsd(pnl)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {t("positions.markPrice", { price: formatPrice(currentPrice) })}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-surface px-3 py-2">
                      <p className="text-xs text-muted">{t("positions.positionValue")}</p>
                      <p className="mt-1 font-semibold text-foreground">
                        {formatUsd(position.positionValue ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-surface px-3 py-2">
                      <p className="text-xs text-muted">{t("positions.leverage")}</p>
                      <p className="mt-1 font-semibold text-foreground">
                        {position.leverage.value}x {position.leverage.type}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-separator bg-surface px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {t("positions.protection")}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {protectionState.stopLoss ||
                          protectionState.takeProfit
                            ? t("positions.manageSlTp")
                            : t("positions.addSlTp")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          haptics.light();
                          setEditingProtection({
                            coin: position.coin,
                            direction,
                            displayName,
                            currentPrice,
                            entryPrice: position.entryPx,
                            size: Math.abs(position.szi),
                            draft: createProtectionDraft(
                              protectionState.stopLoss?.triggerPx ?? null,
                              protectionState.takeProfit?.triggerPx ?? null,
                            ),
                          });
                        }}
                        className="flex-shrink-0 rounded-full bg-white px-3 py-2 text-xs font-semibold text-primary shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 active:bg-gray-100"
                      >
                        {protectionState.stopLoss || protectionState.takeProfit
                          ? t("positions.editProtection")
                          : t("positions.addProtection")}
                      </button>
                    </div>

                    {protectionState.stopLoss || protectionState.takeProfit ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {protectionState.stopLoss?.triggerPx != null && (
                          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 shadow-sm">
                            SL {formatPrice(protectionState.stopLoss.triggerPx)}
                          </span>
                        )}
                        {protectionState.takeProfit?.triggerPx != null && (
                          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-emerald-600 shadow-sm">
                            TP{" "}
                            {formatPrice(protectionState.takeProfit.triggerPx)}
                          </span>
                        )}
                        {protectionState.needsReview && (
                          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                            {t("positions.reviewProtection")}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        haptics.medium();
                        setPendingCloseCoin(position.coin);
                        closePosition.mutate(position.coin, {
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
                      disabled={pendingCloseCoin === position.coin}
                      className="flex-1 rounded-full bg-[#111827] px-4 py-3 text-sm font-semibold text-white transition-opacity active:opacity-80"
                    >
                      {pendingCloseCoin === position.coin
                        ? t("common.closing")
                        : t("common.close")}
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(
                          `/trade/${encodeURIComponent(position.coin)}?side=${isLong ? "short" : "long"}`,
                        );
                      }}
                      className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors active:bg-primary-dark"
                    >
                      {t("positions.tradeMore")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "orders" && (
        <div className="space-y-3">
          {!openOrders || openOrders.length === 0 ? (
            <PositionsEmptyState />
          ) : (
            openOrders.map((order: any) => {
              const orderCoin = order.coin.includes(":")
                ? order.coin.split(":")[1]
                : order.coin;
              const linkedPosition = positionsByCoin.get(order.coin);
              const orderDirection: PositionDirection | null = linkedPosition
                ? linkedPosition.szi > 0
                  ? "long"
                  : "short"
                : null;
              const orderCurrentPrice = mids?.[order.coin]
                ? parseFloat(mids[order.coin])
                : (linkedPosition?.entryPx ?? null);
              const protectionKind = orderDirection
                ? classifyProtectionOrder(
                    order as OpenOrder,
                    orderDirection,
                    orderCurrentPrice,
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
              const orderTypeLabel =
                order.orderType === "market"
                  ? t("trade.orderTypeMarket")
                  : t("trade.orderTypeLimit");

              return (
                <div
                  key={order.oid}
                  className="rounded-2xl border border-separator bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenIcon coin={orderCoin.split("/")[0]} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-foreground">
                            {orderCoin}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              protectionKind === "stopLoss"
                                ? "bg-rose-50 text-rose-600"
                                : protectionKind === "takeProfit"
                                  ? "bg-emerald-50 text-emerald-600"
                                  : order.side === "buy"
                                    ? "bg-blue-50 text-primary"
                                    : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {orderBadgeLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {protectionKind
                            ? t("positions.reduceOnlyTrigger")
                            : t("positions.orderType", { type: orderTypeLabel })}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        haptics.medium();
                        setPendingCancelOid(order.oid);
                        cancelOrder.mutate(
                          { coin: order.coin, oid: order.oid },
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
                      disabled={pendingCancelOid === order.oid}
                      className="rounded-full bg-red-50 px-4 py-2 text-sm font-semibold text-negative transition-colors active:bg-red-100"
                    >
                      {pendingCancelOid === order.oid
                        ? t("common.canceling")
                        : t("common.cancel")}
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-surface px-3 py-2">
                      <p className="text-xs text-muted">{t("positions.size")}</p>
                      <p className="mt-1 font-semibold text-foreground">
                        {order.sz}
                      </p>
                    </div>
                    <div className="rounded-xl bg-surface px-3 py-2">
                      <p className="text-xs text-muted">
                        {protectionKind ? t("positions.triggerPrice") : t("positions.limitPrice")}
                      </p>
                      <p className="mt-1 font-semibold text-foreground">
                        {protectionKind && order.triggerPx != null
                          ? formatPrice(order.triggerPx)
                          : order.limitPx
                            ? formatPrice(order.limitPx)
                            : "\u2014"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
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
                  className="rounded-2xl border border-separator bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {fill.coin}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {fill.side === "buy" ? t("positions.bought") : t("positions.sold")} {fill.sz} @ $
                        {fill.px}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold ${isPositive ? "text-positive" : "text-negative"}`}
                      >
                        {isPositive ? "+" : ""}
                        {fill.closedPnl.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
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
