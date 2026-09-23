import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useTranslation } from "react-i18next";
import {
  findProtectionSideIssue,
  getBuilderFeeTenthsBp,
  getMarketBaseAsset,
  getAvailableCollateralForMarket,
  getMarketDisplayName,
  truncateToDecimals,
  useMarketData,
  useMarketPrice,
  usePlaceOrder,
  useSetupTrading,
  useUpsertPositionProtection,
  useUserFees,
  useUserState,
  validateOrderInput,
} from "@repo/hyperliquid-sdk";
import type { AnyMarket, Order } from "@repo/types";
import { ProtectionSheet } from "../components/ProtectionSheet";
import { SegmentedControl } from "../components/SegmentedControl";
import { TokenIcon } from "../components/TokenIcon";
import { TradingSetupSheet } from "../components/TradingSetupSheet";
import { useHaptics } from "../hooks/useHaptics";
import { useToast } from "../hooks/useToast";
import {
  EMPTY_PROTECTION_DRAFT,
  hasProtectionEnabled,
  parseProtectionPrice,
  type PositionDirection,
  type ProtectionDraft,
} from "../lib/protection";
import { getAsyncValueState } from "../lib/async-value-state";
import { acceptDecimalInput } from "../lib/decimal-input";
import { formatUsdPrice } from "../utils/format";

/**
 * Base-tier fallbacks, used only while the account's actual rates load. The
 * quote used to be a hardcoded `size * 0.0005`: only the builder fee, only at
 * its default (VITE_BUILDER_FEE configures it), and nothing for the
 * exchange's own cut — so the number a user weighed before tapping Confirm
 * read roughly half of what a market order costs. The real rates come from
 * the exchange per account, volume tier and referral discount applied.
 */
const HL_TAKER_FEE_RATE = 0.00045;
const HL_MAKER_FEE_RATE = 0.00015;

/** "0.045%" — trimmed, for the review screen's fee breakdown. */
function formatFeeRate(rate: number): string {
  return `${(rate * 100).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")}%`;
}

function formatUsdInput(value: number): string {
  const truncated = Math.floor(value * 100) / 100;
  if (Number.isNaN(truncated) || truncated <= 0) return "0";
  return truncated
    .toFixed(2)
    .replace(/\.00$/u, "")
    .replace(/(\.\d)0$/u, "$1");
}

/** Cents, as the on-screen pad allowed. */
const SIZE_MAX_DECIMALS = 2;
/** Eight places, matching truncateToDecimals(currentPrice, 8) on the Market fill. */
const PRICE_MAX_DECIMALS = 8;


const AMOUNT_INPUT_CLASS =
  "editorial-display w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20, 25, 50];

type TradeFlowStep = "draft" | "review" | "success";

interface ReviewedTrade {
  order: Order;
  protectionEnabled: boolean;
  stopLossPx: number | null;
  takeProfitPx: number | null;
  estimatedProtectionSize: number;
  liquidationPx: number | null;
}

interface TradeResult {
  protectionWarning: boolean;
  detail?: string;
}

export function TradePage() {
  const { symbol: rawSymbol = "BTC" } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(rawSymbol);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const haptics = useHaptics();
  const toast = useToast();
  const { t } = useTranslation();
  const { authenticated, user } = usePrivy();

  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [leverage, setLeverage] = useState(10);
  const [tif, setTif] = useState<"Gtc" | "Alo" | "Ioc">("Gtc");
  const [protectionOpen, setProtectionOpen] = useState(false);
  const [protectionDraft, setProtectionDraft] = useState<ProtectionDraft>(
    EMPTY_PROTECTION_DRAFT,
  );
  const [flowStep, setFlowStep] = useState<TradeFlowStep>("draft");
  const [reviewedTrade, setReviewedTrade] = useState<ReviewedTrade | null>(null);
  const [tradeResult, setTradeResult] = useState<TradeResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [setupVisible, setSetupVisible] = useState(false);
  const setupWalletRef = useRef<string | null>(null);
  // Guards the confirm tap synchronously. placeOrder.isPending disables the
  // button only after React Query's state change re-renders, so two taps
  // landing in the same frame both reached mutateAsync — two live orders with
  // two distinct cloids. The fiat checkout solved this class with an
  // idempotency key; the trade path gets the ref because each tap must mint a
  // fresh cloid once an order actually settles.
  const confirmInFlightRef = useRef(false);

  const side: "buy" | "sell" = useMemo(() => {
    // Every in-app link passes ?side, so the default only decides what a
    // shared or hand-typed link opens with. It used to be sell — a newcomer
    // following a bare link landed on a short.
    const requestedSide = searchParams.get("side");
    return requestedSide === "short" || requestedSide === "sell"
      ? "sell"
      : "buy";
  }, [searchParams]);

  const [activeSide, setActiveSide] = useState<"buy" | "sell">(side);

  const { data: markets } = useMarketData();
  const {
    data: currentPrice,
    isError: marketPriceError,
    isLoading: marketPriceLoading,
  } = useMarketPrice(symbol);
  const {
    data: userState,
    isError: userStateError,
    isLoading: userStateLoading,
  } = useUserState();
  const placeOrder = usePlaceOrder();
  const upsertPositionProtection = useUpsertPositionProtection();

  const selectedPerpMarket = useMemo(
    () =>
      (markets?.perp as Array<any> | undefined)?.find(
        (market) => market.name === symbol,
      ) ?? null,
    [markets, symbol],
  );
  const {
    status: tradingStatus,
    setup: tradingSetup,
  } = useSetupTrading({ isHip3: Boolean(selectedPerpMarket?.isHip3) });

  const isPerp = true;
  const selectedMarket = selectedPerpMarket;
  const selectedMarketForDisplay = useMemo<AnyMarket | null>(
    () => (selectedPerpMarket ? { ...selectedPerpMarket, type: "perp" as const } : null),
    [selectedPerpMarket],
  );

  const displayName = useMemo(
    () =>
      selectedMarketForDisplay
        ? getMarketDisplayName(selectedMarketForDisplay)
        : getMarketDisplayName(symbol),
    [selectedMarketForDisplay, symbol],
  );

  const baseToken = useMemo(
    () =>
      selectedMarketForDisplay
        ? getMarketBaseAsset(selectedMarketForDisplay)
        : getMarketBaseAsset(symbol),
    [selectedMarketForDisplay, symbol],
  );

  const maxLeverage = useMemo(
    () => selectedPerpMarket?.maxLeverage ?? 50,
    [selectedPerpMarket],
  );

  const leverageOptions = useMemo(
    () => LEVERAGE_OPTIONS.filter((value) => value <= maxLeverage),
    [maxLeverage],
  );

  const amountNum = parseFloat(amount) || 0;
  const limitPriceNum = parseFloat(limitPrice) || 0;

  const { data: userFees } = useUserFees();
  const builderFeeRate = getBuilderFeeTenthsBp() / 100_000;
  // Worst-case exchange rate for this order: a market order takes, and a Gtc
  // limit can cross on entry, so only a post-only (Alo) order is quoted at
  // the maker rate. The quote must never read lower than the possible cost.
  const exchangeFeeRate =
    orderType === "limit" && tif === "Alo"
      ? (userFees?.makerRate ?? HL_MAKER_FEE_RATE)
      : (userFees?.takerRate ?? HL_TAKER_FEE_RATE);
  const totalFeeRate = builderFeeRate + exchangeFeeRate;
  const positionDirection: PositionDirection =
    activeSide === "buy" ? "long" : "short";
  const priceState = getAsyncValueState({
    hasValue: currentPrice != null,
    isLoading: marketPriceLoading,
    isError: marketPriceError,
  });
  const balanceState = getAsyncValueState({
    hasValue: Boolean(userState),
    isLoading: userStateLoading,
    isError: userStateError,
  });

  const availableMarginUsd = useMemo(
    () =>
      isPerp && userState
        ? getAvailableCollateralForMarket({
            abstractionMode: userState.abstractionMode,
            stableBalances: userState.stableBalances,
            fallbackWithdrawable: userState.withdrawableBalance,
            marketName: symbol,
          })
        : 0,
    [isPerp, symbol, userState],
  );

  const currentPositionLeverage = useMemo(() => {
    if (!isPerp) return null;
    const position = (userState?.assetPositions ?? []).find(
      (assetPosition) => assetPosition.position.coin === symbol,
    )?.position;
    return position?.leverage.value ?? null;
  }, [isPerp, symbol, userState?.assetPositions]);

  const leverageSourceRef = useRef<{
    symbol: string;
    positionLeverage: number | null;
  }>({
    symbol: "",
    positionLeverage: null,
  });

  useEffect(() => {
    if (!isPerp) return;

    const nextPositionLeverage = currentPositionLeverage ?? null;
    const leverageSourceChanged =
      leverageSourceRef.current.symbol !== symbol ||
      leverageSourceRef.current.positionLeverage !== nextPositionLeverage;

    if (leverageSourceChanged) {
      leverageSourceRef.current = {
        symbol,
        positionLeverage: nextPositionLeverage,
      };
      setLeverage(
        Math.min(Math.max(nextPositionLeverage ?? 10, 1), maxLeverage),
      );
      return;
    }

    if (leverage > maxLeverage) {
      setLeverage(maxLeverage);
    }
  }, [currentPositionLeverage, isPerp, leverage, maxLeverage, symbol]);

  const validationReferencePrice =
    orderType === "limit"
      ? limitPriceNum || currentPrice || 0
      : currentPrice || 0;
  const validationAvailableBalance = availableMarginUsd;

  const validation = useMemo(() => {
    const minSizeUsd = selectedMarket?.minNotionalUsd ?? 10;
    const minMarginUsd = isPerp
      ? minSizeUsd / Math.max(leverage, 1)
      : minSizeUsd;

    if (!amount) {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason: undefined,
      };
    }

    if (!selectedMarket) {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason: t("trade.marketMetadataUnavailable"),
      };
    }

    if (priceState !== "ready") {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason:
          priceState === "loading"
            ? t("trade.loadingMarketPrice")
            : t("trade.marketPriceUnavailable"),
      };
    }

    if (balanceState !== "ready") {
      return {
        isValid: false,
        minMarginUsd,
        minSizeUsd,
        reason:
          balanceState === "loading"
            ? t("trade.loadingBalance")
            : t("trade.balanceUnavailable"),
      };
    }

    return validateOrderInput(
      {
        coin: symbol,
        side: activeSide,
        sizeUsd: amountNum,
        limitPx:
          orderType === "limit" && limitPriceNum > 0
            ? limitPriceNum
            : undefined,
        orderType,
        reduceOnly: false,
        leverage,
        marketType: "perp",
      },
      {
        name: selectedMarket.name,
        marketType: "perp",
        minNotionalUsd: selectedMarket.minNotionalUsd,
        minBaseSize: selectedMarket.minBaseSize,
        szDecimals: selectedMarket.szDecimals,
        maxLeverage: selectedMarket.maxLeverage,
      },
      validationReferencePrice,
      validationAvailableBalance,
      { requireBalance: true },
    );
  }, [
    amount,
    amountNum,
    isPerp,
    leverage,
    limitPriceNum,
    t,
    orderType,
    selectedMarket,
    activeSide,
    symbol,
    balanceState,
    validationAvailableBalance,
    validationReferencePrice,
    priceState,
  ]);

  const liquidationPx = useMemo(() => {
    if (!isPerp || amountNum === 0 || !currentPrice || leverage <= 1)
      return null;
    // Still an estimate for a fresh isolated position — cross margin and
    // existing positions move the real number — but with the maintenance
    // margin term included: Hyperliquid's maintenance rate is half the
    // initial margin at max leverage, and omitting it showed liquidation
    // further away than it is, on the flattering side of wrong.
    const maintenanceMarginRate = 1 / (2 * maxLeverage);
    return activeSide === "buy"
      ? currentPrice * (1 - 1 / leverage + maintenanceMarginRate)
      : currentPrice * (1 + 1 / leverage - maintenanceMarginRate);
  }, [amountNum, currentPrice, isPerp, leverage, activeSide, maxLeverage]);

  const estimatedProtectionSize = useMemo(() => {
    if (!isPerp || amountNum <= 0 || !currentPrice) return 0;
    return amountNum / currentPrice;
  }, [amountNum, currentPrice, isPerp]);

  const stopLossPx = parseProtectionPrice(protectionDraft.stopLossPx);
  const takeProfitPx = parseProtectionPrice(protectionDraft.takeProfitPx);
  const protectionEnabled = isPerp && hasProtectionEnabled(protectionDraft);
  const protectionSubmitDisabled = orderType === "limit";
  const protectionSummary = [
    protectionDraft.stopLossEnabled && stopLossPx != null
      ? `SL ${formatUsdPrice(stopLossPx)}`
      : null,
    protectionDraft.takeProfitEnabled && takeProfitPx != null
      ? `TP ${formatUsdPrice(takeProfitPx)}`
      : null,
  ].filter((value): value is string => value != null);

  // Depend on reset, not on the mutation object. useMutation returns a fresh
  // object literal every render, so depending on tradingSetup re-ran this
  // effect on every render; while signed out it then called reset(), which
  // notifies the observer, which renders again — an unbounded loop for anyone
  // not authenticated. reset is bound once in the MutationObserver constructor
  // and the observer is created through useState, so its identity is stable.
  const resetTradingSetup = tradingSetup.reset;

  useEffect(() => {
    if (!authenticated) {
      setupWalletRef.current = null;
      resetTradingSetup();
      setSetupVisible(false);
    }
  }, [authenticated, resetTradingSetup]);

  const isPending =
    placeOrder.isPending ||
    upsertPositionProtection.isPending;
  // A limit order must not be reviewed with a zero price: the field is
  // optional in validateOrderInput (market orders have no limit), so without
  // this gate an untouched price sailed through to a review row reading "—"
  // and an SDK error on submit. Both numbers come from parseFloat(...) || 0,
  // so an empty or half-typed field reads as zero here rather than as NaN.
  const isSubmitDisabled =
    amountNum === 0 ||
    isPending ||
    !validation.isValid ||
    (orderType === "limit" && limitPriceNum <= 0);

  const handleAmountChange = (value: string) => {
    setSubmitError(null);
    setAmount((previous) =>
      acceptDecimalInput(value, previous, SIZE_MAX_DECIMALS),
    );
  };

  const handleLimitPriceChange = (value: string) => {
    setSubmitError(null);
    setLimitPrice((previous) =>
      acceptDecimalInput(value, previous, PRICE_MAX_DECIMALS),
    );
  };

  const handleQuickFill = (usdValue: number) => {
    haptics.light();
    handleAmountChange(formatUsdInput(usdValue));
  };

  const handleLeveragePill = (value: number) => {
    haptics.selection();
    setSubmitError(null);
    setLeverage(value);
  };

  const handleProtectionSubmit = () => {
    haptics.light();
    setProtectionOpen(false);
  };

  const handleSideToggle = (newSide: "buy" | "sell") => {
    if (newSide !== activeSide) {
      haptics.light();
      setActiveSide(newSide);
      // Triggers are only meaningful relative to a direction: a stop below the
      // mark protects a long and targets a short. Carrying the draft across
      // the toggle is what made a wrong-sided stop reachable without the user
      // editing anything, so the levels are cleared rather than reinterpreted.
      setProtectionDraft(EMPTY_PROTECTION_DRAFT);
    }
  };

  const handleReviewOrder = () => {
    setSubmitError(null);

    if (!validation.isValid) {
      haptics.error();
      setSubmitError(
        validation.reason ?? t("trade.checkOrderDetails"),
      );
      return;
    }

    if (orderType === "market" && protectionEnabled) {
      if (protectionDraft.stopLossEnabled && stopLossPx == null) {
        haptics.error();
        setSubmitError(t("trade.enterValidSl"));
        return;
      }

      if (protectionDraft.takeProfitEnabled && takeProfitPx == null) {
        haptics.error();
        setSubmitError(t("trade.enterValidTp"));
        return;
      }

      // Refuse a wrong-sided trigger here, before the entry order exists.
      //
      // This rule used to be enforced only inside planPositionProtection,
      // which runs after placeOrder has already filled — so the position
      // opened and only the stop was refused, leaving a live leveraged trade
      // unprotected with nothing but a toast. The draft also survives the
      // buy/sell toggle, so a stop set for a long and submitted as a short
      // reached that state without the user changing anything.
      //
      // It cannot make the pair atomic: the mark can still move between this
      // check and the fill, and the SDK check remains the backstop for that.
      // What it removes is the deterministic case, which is the common one.
      const sideIssue = findProtectionSideIssue({
        direction: activeSide === "buy" ? "long" : "short",
        referencePrice: validationReferencePrice,
        stopLossPx: protectionDraft.stopLossEnabled ? stopLossPx : null,
        takeProfitPx: protectionDraft.takeProfitEnabled ? takeProfitPx : null,
      });
      if (sideIssue) {
        haptics.error();
        setSubmitError(t(`trade.protectionSide.${sideIssue}`));
        return;
      }
    }

    const order: Order = {
      coin: symbol,
      side: activeSide,
      sizeUsd: amountNum,
      orderType,
      reduceOnly: false,
      leverage,
      marketType: "perp" as const,
      ...(orderType === "limit" && { limitPx: limitPriceNum, tif }),
    };

    haptics.light();
    setReviewedTrade({
      order,
      protectionEnabled: orderType === "market" && protectionEnabled,
      stopLossPx,
      takeProfitPx,
      estimatedProtectionSize,
      liquidationPx,
    });
    setFlowStep("review");
  };

  const handleConfirmOrder = async () => {
    if (!reviewedTrade || confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    try {
      await submitReviewedOrder();
    } finally {
      confirmInFlightRef.current = false;
    }
  };

  const submitReviewedOrder = async () => {
    if (!reviewedTrade) return;
    setSubmitError(null);
    haptics.medium();

    if (authenticated) {
      if (!tradingStatus.canTrade && tradingStatus.blockingSteps.length > 0) {
        const walletAddress = user?.wallet?.address ?? null;
        if (setupWalletRef.current !== walletAddress || !setupVisible) {
          tradingSetup.reset();
        }
        setupWalletRef.current = walletAddress;
        setSetupVisible(true);
        return;
      }
    }

    const sideLabel =
      reviewedTrade.order.side === "buy" ? t("common.long") : t("common.short");

    try {
      await placeOrder.mutateAsync(reviewedTrade.order);

      if (reviewedTrade.protectionEnabled) {
        try {
          await upsertPositionProtection.mutateAsync({
            coin: symbol,
            stopLossPx: reviewedTrade.stopLossPx,
            takeProfitPx: reviewedTrade.takeProfitPx,
            sizeHint:
              reviewedTrade.estimatedProtectionSize *
              (reviewedTrade.order.side === "buy" ? 1 : -1),
            skipCancelExisting: true,
          });
          haptics.success();
          toast.success(t("trade.orderPlacedWithProtection", { side: sideLabel }));
          setTradeResult({ protectionWarning: false });
          setFlowStep("success");
          return;
        } catch (error) {
          const detail =
            error instanceof Error
              ? t("trade.orderPlacedProtectionFailed", {
                  side: sideLabel,
                  error: error.message,
                })
              : t("trade.orderPlacedProtectionFailedGeneric", {
                  side: sideLabel,
                });
          haptics.error();
          toast.error(detail);
          setTradeResult({ protectionWarning: true, detail });
          setFlowStep("success");
          return;
        }
      }

      haptics.success();
      toast.success(t("trade.orderPlaced", { side: sideLabel }));
      setTradeResult({ protectionWarning: false });
      setFlowStep("success");
    } catch (error) {
      haptics.error();
      const detail = error instanceof Error ? error.message : t("trade.orderFailed");
      toast.error(detail);
      setSubmitError(detail);
    }
  };

  const btcEquivalent = currentPrice ? (amountNum / currentPrice).toFixed(4) : "0.0000";

  if (flowStep === "success" && reviewedTrade && tradeResult) {
    return (
      <div className="editorial-page flex min-h-full flex-col px-4 py-5">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ${tradeResult.protectionWarning ? "bg-negative/10 text-negative" : "p34k-signal"}`}>
            {tradeResult.protectionWarning ? "!" : "OK"}
          </div>
          <p className="editorial-kicker mt-6">{t("trade.orderResult")}</p>
          <h1 className="editorial-heading text-foreground">
            {tradeResult.protectionWarning
              ? t("trade.protectionWarningTitle")
              : t("trade.orderPlacedTitle")}
          </h1>
          <p className="mt-3 max-w-[18rem] text-sm leading-relaxed text-muted">
            {tradeResult.protectionWarning
              ? t("trade.protectionWarningBody")
              : t("trade.orderPlacedBody")}
          </p>
        </div>
        <div className="space-y-3 bottom-dock-safe">
          <button type="button" onClick={() => navigate("/positions")} className="editorial-button-primary w-full">
            {t("trade.viewPositions")}
          </button>
          <button type="button" onClick={() => navigate("/")} className="editorial-button-secondary w-full">
            {t("trade.returnHome")}
          </button>
        </div>
      </div>
    );
  }

  if (flowStep === "review" && reviewedTrade) {
    const reviewedSide =
      reviewedTrade.order.side === "buy" ? t("common.long") : t("common.short");
    const reviewedLeverage = reviewedTrade.order.leverage ?? 1;
    const reviewedExchangeRate =
      reviewedTrade.order.orderType === "limit" &&
      reviewedTrade.order.tif === "Alo"
        ? (userFees?.makerRate ?? HL_MAKER_FEE_RATE)
        : (userFees?.takerRate ?? HL_TAKER_FEE_RATE);
    const reviewedSizeUsd = reviewedTrade.order.sizeUsd;

    return (
      <div className="editorial-page flex min-h-full flex-col">
        <header className="px-4 pb-4 pt-5">
          <h1 className="editorial-heading">{t("trade.reviewOrder")}</h1>
        </header>
        <div className="flex-1 px-4">
          <div className="editorial-card overflow-hidden px-4 py-1">
            {[
              [t("trade.market"), displayName],
              [t("trade.side"), reviewedSide],
              [t("trade.orderType"), reviewedTrade.order.orderType.toUpperCase()],
              [t("trade.size"), `$${reviewedTrade.order.sizeUsd.toLocaleString()}`],
              [t("trade.leverage"), `${reviewedLeverage}x`],
              [t("trade.margin"), `$${(reviewedTrade.order.sizeUsd / reviewedLeverage).toFixed(2)}`],
              [t("trade.fee"), `$${(reviewedSizeUsd * (builderFeeRate + reviewedExchangeRate)).toFixed(2)}`],
              [t("trade.feeBuilder"), `$${(reviewedSizeUsd * builderFeeRate).toFixed(2)} · ${formatFeeRate(builderFeeRate)}`],
              [t("trade.feeExchange"), `$${(reviewedSizeUsd * reviewedExchangeRate).toFixed(2)} · ${formatFeeRate(reviewedExchangeRate)}`],
              [t("trade.liq"), reviewedTrade.liquidationPx != null ? formatUsdPrice(reviewedTrade.liquidationPx) : "-"],
              ...(reviewedTrade.order.orderType === "limit"
                ? [
                    [t("trade.limitPrice"), formatUsdPrice(reviewedTrade.order.limitPx ?? 0)],
                    [t("trade.timeInForce"), (reviewedTrade.order.tif ?? "Gtc").toUpperCase()],
                  ]
                : []),
              ...(reviewedTrade.protectionEnabled
                ? [
                    ["SL / TP", protectionSummary.join(" / ") || t("common.unavailable")],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-separator py-4 last:border-b-0">
                <span className="editorial-kicker">{label}</span>
                <span className="editorial-mono text-sm font-semibold text-foreground">{value}</span>
              </div>
            ))}
          </div>
          {reviewedTrade.order.orderType === "limit" ? (
            <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
              {t("trade.addProtectionAfterFills")}
            </p>
          ) : null}
          {submitError ? <p className="mt-4 text-center text-sm text-negative">{submitError}</p> : null}
        </div>
        <div className="border-t border-separator bg-white px-4 pt-3 bottom-dock-safe">
          <button type="button" onClick={handleConfirmOrder} disabled={isPending} className="editorial-button-primary w-full disabled:opacity-40">
            {isPending ? t("trade.placingOrder") : t("trade.confirmOrder")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSubmitError(null);
              setFlowStep("draft");
            }}
            className="mt-2 w-full py-3 text-sm font-semibold text-primary"
          >
            {t("trade.editOrder")}
          </button>
        </div>
        <TradingSetupSheet
          isOpen={setupVisible}
          onClose={() => setSetupVisible(false)}
          setup={tradingSetup}
          isExpired={tradingStatus.isAgentExpired}
          status={tradingStatus}
        />
      </div>
    );
  }

  return (
    <div className="editorial-page flex h-full flex-col">
      {/* Header */}
      <header className="flex-none px-4 pb-3 pt-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="editorial-heading text-foreground">{t("trade.newOrder")}</h1>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-2">
            <TokenIcon coin={baseToken} size={20} />
            <span className="editorial-mono text-sm font-semibold text-foreground">{baseToken}</span>
          </div>
        </div>
      </header>

      <div className="px-4 pb-4">
        <SegmentedControl
          label={t("trade.orderType", { type: "" }).trim() || t("trade.newOrder")}
          value={orderType}
          onChange={(type) => {
            setSubmitError(null);
            setOrderType(type);
          }}
          options={[
            { value: "market", label: t("trade.orderTypeMarket") },
            { value: "limit", label: t("trade.orderTypeLimit") },
          ]}
        />
      </div>

      {/* Buy/Sell Toggle.
          The two halves mirror each other exactly — kicker, arrow, and the
          profit hint on whichever is active. Sell used to be the odd one out
          (kicker reading "OR", no arrow, no hint, and a hardcoded near-black
          while buy was primary blue). Colors follow the design handoff's one
          rule for direction — green long, red short — which the coin page's
          dock already used, so the same action no longer changes color
          between screens. */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleSideToggle("buy")}
            className={`rounded-[24px] border p-4 text-left transition-all ${
              activeSide === "buy"
                ? "border-positive bg-positive text-white shadow-[0_18px_36px_rgba(27,148,93,0.24)]"
                : "border-border bg-white text-muted"
            }`}
          >
            <div className="editorial-kicker mb-2 opacity-80">
              {t("trade.goingLong")}
            </div>
            <div className="editorial-display-sm flex items-center gap-1">
              {t("trade.buy")} <span className="text-lg">↑</span>
            </div>
            {activeSide === "buy" && (
              <div className="mt-2 text-[10px] opacity-80">
                {t("trade.profitWhenPriceRises")}
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleSideToggle("sell")}
            className={`rounded-[24px] border p-4 text-left transition-all ${
              activeSide === "sell"
                ? "border-negative bg-negative text-white shadow-[0_18px_36px_rgba(235,77,61,0.2)]"
                : "border-border bg-white text-muted"
            }`}
          >
            <div className="editorial-kicker mb-2 opacity-80">
              {t("trade.goingShort")}
            </div>
            <div className="editorial-display-sm flex items-center gap-1">
              {t("trade.sell")} <span className="text-lg">↓</span>
            </div>
            {activeSide === "sell" && (
              <div className="mt-2 text-[10px] opacity-80">
                {t("trade.profitWhenPriceFalls")}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {/* Size, and on a limit order the price, each typed into directly.
            The two used to share one on-screen pad, so the page had to track
            which of them the pad was aimed at — and the price was edited on a
            second step this card never rendered: the first Review tap flipped
            the pad over to it while the hero went on showing the size, so the
            typed price stayed invisible all the way to a review row reading
            "—". Both fields on screen at once, and there is nothing to aim. */}
        <div className="editorial-card p-5">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="trade-size" className="editorial-kicker">
              {`${t("trade.size")} · USD`}
            </label>
            <span className="editorial-mono text-xs text-muted">
              {t("trade.availShort")} {availableMarginUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="editorial-display text-foreground">$</span>
            <input
              id="trade-size"
              type="number"
              name="trade-size"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => handleAmountChange(event.target.value)}
              placeholder="0"
              className={AMOUNT_INPUT_CLASS}
            />
          </div>
          <div className="editorial-mono mt-1 text-sm text-muted">
            {`≈ ${btcEquivalent} ${baseToken}`}
          </div>

          {/* Quick Amount Buttons */}
          <div className="flex gap-2 mt-4">
            {[
              { label: "$100", value: 100 },
              { label: "$500", value: 500 },
              { label: "$1k", value: 1000 },
              { label: "$5k", value: 5000 },
            ].map(({ label, value }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleQuickFill(value)}
                className="flex-1 rounded-[18px] border border-border bg-[var(--color-primary-soft)] py-2.5 text-sm font-semibold text-foreground transition-colors active:bg-[var(--color-primary-soft-strong)]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {orderType === "limit" && (
          <div className="editorial-card mt-4 p-5">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="trade-limit-price" className="editorial-kicker">
                {t("trade.limitPrice")}
              </label>
              <span className="editorial-mono text-xs text-muted">
                {t("trade.market")} {formatUsdPrice(currentPrice ?? 0)}
              </span>
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="editorial-display text-foreground">$</span>
              <input
                id="trade-limit-price"
                type="number"
                name="trade-limit-price"
                inputMode="decimal"
                autoComplete="off"
                value={limitPrice}
                onChange={(event) => handleLimitPriceChange(event.target.value)}
                placeholder="0"
                className={AMOUNT_INPUT_CLASS}
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() =>
                  currentPrice != null &&
                  handleLimitPriceChange(
                    truncateToDecimals(currentPrice, PRICE_MAX_DECIMALS),
                  )
                }
                className="flex-1 rounded-[18px] border border-border bg-[var(--color-primary-soft)] py-2.5 text-sm font-semibold text-foreground transition-colors active:bg-[var(--color-primary-soft-strong)]"
              >
                {t("trade.market")}
              </button>
            </div>

            {/* Time in force. The state, the fee quote's post-only branch and
                the review row all existed; the control that sets them never
                shipped, so every limit order was silently Gtc. */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="editorial-kicker">{t("trade.timeInForce")}</span>
                <span className="editorial-mono text-xs text-muted">
                  {tif === "Gtc"
                    ? t("trade.goodTillCancelled")
                    : tif === "Alo"
                      ? t("trade.addLiquidityOnly")
                      : t("trade.immediateOrCancel")}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                {(["Gtc", "Alo", "Ioc"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      haptics.selection();
                      setTif(option);
                    }}
                    className={`editorial-chip editorial-chip-compact ${
                      tif === option ? "editorial-chip-active" : ""
                    }`}
                  >
                    {option === "Gtc"
                      ? t("trade.gtc")
                      : option === "Alo"
                        ? t("trade.alo")
                        : t("trade.ioc")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Leverage Section */}
        {isPerp && (
          <div className="editorial-card mt-4 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="editorial-kicker">
                {t("trade.leverage")}
              </span>
              <span className="editorial-display-sm text-foreground">
                {leverage}×
              </span>
            </div>
            
            {/* Leverage Slider */}
            <div className="relative mb-3">
              <input
                type="range"
                min={1}
                max={maxLeverage}
                value={leverage}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  haptics.selection();
                  setLeverage(value);
                }}
                className="w-full h-2 bg-surface rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md"
              />
            </div>

            {/* Leverage Pills */}
            <div className="flex gap-2">
              {leverageOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleLeveragePill(value)}
                  className={`editorial-chip editorial-chip-compact ${
                    leverage === value
                      ? "editorial-chip-active"
                      : ""
                  }`}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Trade Stats */}
        <div className="editorial-card mt-4 space-y-3 p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="editorial-kicker">{t("trade.liq")}</span>
            <span className="editorial-mono font-semibold text-foreground">
              {liquidationPx != null ? formatUsdPrice(liquidationPx) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="editorial-kicker">{t("trade.fee")}</span>
            <span className="editorial-mono font-semibold text-foreground">
              ${(amountNum * totalFeeRate).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="editorial-kicker">{t("trade.margin")}</span>
            <span className="editorial-mono font-semibold text-foreground">
              ${(amountNum / leverage).toFixed(2)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setProtectionOpen(true)}
          className="editorial-card mt-4 flex w-full items-center justify-between p-4 text-left"
        >
          <div>
            <span className="editorial-kicker">{t("trade.protection")}</span>
            <p className="mt-1 max-w-[15rem] text-sm text-muted">
              {orderType === "limit"
                ? t("trade.addProtectionAfterFills")
                : t("trade.optionalSlTp")}
            </p>
          </div>
          <span className="editorial-mono text-xs font-semibold text-primary">
            {protectionSummary.length > 0 ? protectionSummary.join(" / ") : t("common.add")}
          </span>
        </button>
      </div>

      {/* Submit Button */}
      <div className="flex-none border-t border-separator bg-white/92 px-4 pt-2 pb-4 backdrop-blur-md bottom-dock-safe">
        <button
          type="button"
          onClick={handleReviewOrder}
          disabled={isSubmitDisabled}
          className={`w-full rounded-full py-4 text-base font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40 ${
            activeSide === "buy"
              ? "bg-positive shadow-[0_18px_36px_rgba(27,148,93,0.28)]"
              : "bg-negative shadow-[0_18px_36px_rgba(235,77,61,0.22)]"
          }`}
        >
          {t("trade.reviewOrder")}
        </button>

        {validation.reason && !submitError && (
          <p className="text-xs text-center text-warning mt-2">
            {validation.reason}
          </p>
        )}
        {submitError && (
          <p className="text-xs text-center text-negative mt-2">
            {submitError}
          </p>
        )}
      </div>

      <ProtectionSheet
        isOpen={protectionOpen}
        onClose={() => setProtectionOpen(false)}
        onSubmit={handleProtectionSubmit}
        draft={protectionDraft}
        onChange={setProtectionDraft}
        direction={positionDirection}
        marketLabel={displayName}
        currentPrice={currentPrice ?? null}
        referencePrice={
          orderType === "limit"
            ? limitPriceNum || currentPrice || null
            : currentPrice ?? null
        }
        size={estimatedProtectionSize}
        submitLabel={protectionSubmitDisabled ? t("common.done") : t("trade.applyProtection")}
        disabledNotice={
          protectionSubmitDisabled
            ? t("trade.addProtectionAfterFills")
            : null
        }
      />

      <TradingSetupSheet
        isOpen={setupVisible}
        onClose={() => setSetupVisible(false)}
        setup={tradingSetup}
        isExpired={tradingStatus.isAgentExpired}
        status={tradingStatus}
      />
    </div>
  );
}
