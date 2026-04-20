import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useTranslation } from "react-i18next";
import {
  getMarketBaseAsset,
  getAvailableCollateralForMarket,
  getMarketDisplayName,
  useMarketData,
  useMarketPrice,
  usePlaceOrder,
  useSetupTrading,
  useUpsertPositionProtection,
  useUserState,
  validateOrderInput,
} from "@repo/hyperliquid-sdk";
import type { AnyMarket, Order } from "@repo/types";
import { NumPad } from "../components/NumPad";
import { ProtectionSheet } from "../components/ProtectionSheet";
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
import { formatPrice } from "../utils/format";

function formatUsdInput(value: number): string {
  const truncated = Math.floor(value * 100) / 100;
  if (Number.isNaN(truncated) || truncated <= 0) return "0";
  return truncated
    .toFixed(2)
    .replace(/\.00$/u, "")
    .replace(/(\.\d)0$/u, "$1");
}

function formatUsdParts(value: number): { integer: string; decimal: string } {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  const parts = formatted.split(".");
  return {
    integer: parts[0] || "0",
    decimal: parts[1] || "00",
  };
}

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20, 25, 50];

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
  const [step, setStep] = useState<"amount" | "price">("amount");
  const [leverage, setLeverage] = useState(10);
  const [tif, setTif] = useState<"Gtc" | "Alo" | "Ioc">("Gtc");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [protectionOpen, setProtectionOpen] = useState(false);
  const [protectionDraft, setProtectionDraft] = useState<ProtectionDraft>(
    EMPTY_PROTECTION_DRAFT,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [setupVisible, setSetupVisible] = useState(false);
  const setupWalletRef = useRef<string | null>(null);

  const side: "buy" | "sell" = useMemo(() => {
    const requestedSide = searchParams.get("side");
    return requestedSide === "long" || requestedSide === "buy" ? "buy" : "sell";
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
    refetch: refetchUserState,
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

  const maxPositionUsd = useMemo(
    () => availableMarginUsd * leverage,
    [availableMarginUsd, leverage],
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
      },
      validationReferencePrice,
      validationAvailableBalance,
    );
  }, [
    amount,
    amountNum,
    isPerp,
    leverage,
    limitPriceNum,
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
    return activeSide === "buy"
      ? currentPrice * (1 - 1 / leverage)
      : currentPrice * (1 + 1 / leverage);
  }, [amountNum, currentPrice, isPerp, leverage, activeSide]);

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
      ? `SL ${formatPrice(stopLossPx)}`
      : null,
    protectionDraft.takeProfitEnabled && takeProfitPx != null
      ? `TP ${formatPrice(takeProfitPx)}`
      : null,
  ].filter((value): value is string => value != null);

  useEffect(() => {
    if (!authenticated) {
      setupWalletRef.current = null;
      tradingSetup.reset();
      setSetupVisible(false);
    }
  }, [authenticated, tradingSetup]);

  const isPending =
    placeOrder.isPending ||
    upsertPositionProtection.isPending;
  const isSubmitDisabled = amountNum === 0 || isPending || !validation.isValid;

  const handleAmountChange = (value: string) => {
    setSubmitError(null);
    setAmount(value);
  };

  const handleLimitPriceChange = (value: string) => {
    setSubmitError(null);
    setLimitPrice(value);
  };

  const handleQuickFill = (usdValue: number) => {
    haptics.light();
    setSubmitError(null);
    setAmount(formatUsdInput(usdValue));
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
    }
  };

  const handlePrimaryAction = async () => {
    setSubmitError(null);

    if (!validation.isValid) {
      haptics.error();
      setSubmitError(
        validation.reason ?? t("trade.checkOrderDetails"),
      );
      return;
    }

    if (orderType === "limit" && step === "amount") {
      haptics.light();
      setStep("price");
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
    }

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

    const sideLabel = activeSide === "buy" ? t("common.long") : t("common.short");

    try {
      await placeOrder.mutateAsync(order);

      if (orderType === "market" && protectionEnabled) {
        try {
          await upsertPositionProtection.mutateAsync({
            coin: symbol,
            stopLossPx: protectionDraft.stopLossEnabled ? stopLossPx : null,
            takeProfitPx: protectionDraft.takeProfitEnabled
              ? takeProfitPx
              : null,
            sizeHint: estimatedProtectionSize * (activeSide === "buy" ? 1 : -1),
            skipCancelExisting: true,
          });
          haptics.success();
          toast.success(t("trade.orderPlacedWithProtection", { side: sideLabel }));
          navigate(-1);
          return;
        } catch (error) {
          haptics.error();
          toast.error(
            error instanceof Error
              ? t("trade.orderPlacedProtectionFailed", {
                  side: sideLabel,
                  error: error.message,
                })
              : t("trade.orderPlacedProtectionFailedGeneric", {
                  side: sideLabel,
                }),
          );
          navigate("/positions");
          return;
        }
      }

      haptics.success();
      toast.success(t("trade.orderPlaced", { side: sideLabel }));
      navigate(-1);
    } catch (error) {
      haptics.error();
      toast.error(
        error instanceof Error
          ? error.message
          : t("trade.orderFailed"),
      );
    }
  };

  const amountParts = formatUsdParts(amountNum);
  const btcEquivalent = currentPrice ? (amountNum / currentPrice).toFixed(4) : "0.0000";

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <header className="flex-none px-4 py-3 flex items-center justify-between bg-white border-b border-separator">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground">{t("trade.newOrder")}</span>
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface"
          >
            <TokenIcon coin={baseToken} size={20} />
            <span className="text-sm font-semibold text-foreground">{baseToken}</span>
            <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* Buy/Sell Toggle */}
      <div className="px-4 py-4 bg-white">
        <div className="flex rounded-xl bg-surface p-1">
          <button
            type="button"
            onClick={() => handleSideToggle("buy")}
            className={`flex-1 py-3 rounded-lg text-center font-semibold transition-all ${
              activeSide === "buy"
                ? "bg-primary text-white shadow-sm"
                : "text-muted"
            }`}
          >
            <div className="text-xs uppercase tracking-wide mb-0.5 opacity-80">
              {t("trade.goingLong")}
            </div>
            <div className="flex items-center justify-center gap-1">
              {t("trade.buy")} <span className="text-lg">↑</span>
            </div>
            {activeSide === "buy" && (
              <div className="text-[10px] mt-0.5 opacity-80">
                {t("trade.profitWhenPriceRises")}
              </div>
            )}
          </button>
          <div className="w-px bg-separator mx-0.5" />
          <button
            type="button"
            onClick={() => handleSideToggle("sell")}
            className={`flex-1 py-3 rounded-lg text-center font-semibold transition-all ${
              activeSide === "sell"
                ? "bg-secondary text-white shadow-sm"
                : "text-muted"
            }`}
          >
            <div className="text-xs uppercase tracking-wide mb-0.5 opacity-80">
              {t("trade.or")}
            </div>
            <div>{t("trade.sell")}</div>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {/* Size Input */}
        <div className="py-4 border-b border-separator">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted uppercase tracking-wide">
              {t("trade.size")} · USD
            </span>
            <span className="text-xs text-muted font-mono">
              {t("trade.availShort")} {availableMarginUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-[3rem] font-bold tracking-tight text-foreground font-mono">
              ${amountParts.integer}
            </span>
            <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
              .{amountParts.decimal}
            </span>
          </div>
          <div className="text-sm text-muted mt-1 font-mono">
            ≈ {btcEquivalent} {baseToken}
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
                className="flex-1 py-2.5 rounded-lg bg-surface text-sm font-semibold text-foreground transition-colors active:bg-gray-200"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Leverage Section */}
        {isPerp && (
          <div className="py-4 border-b border-separator">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">
                {t("trade.leverage")}
              </span>
              <span className="text-2xl font-bold text-foreground font-mono">
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
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    leverage === value
                      ? "bg-secondary text-white"
                      : "bg-surface text-muted"
                  }`}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Trade Stats */}
        <div className="py-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{t("trade.liq")}</span>
            <span className="font-semibold text-foreground font-mono">
              {liquidationPx != null ? formatPrice(liquidationPx) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{t("trade.fee")}</span>
            <span className="font-semibold text-foreground font-mono">
              ${(amountNum * 0.0005).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{t("trade.margin")}</span>
            <span className="font-semibold text-foreground font-mono">
              ${(amountNum / leverage).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* NumPad */}
      <div className="flex-none pb-1 bg-white">
        <NumPad
          value={step === "amount" ? amount : limitPrice}
          onChange={
            step === "amount" ? handleAmountChange : handleLimitPriceChange
          }
          maxDecimals={step === "amount" ? 2 : 8}
        />
      </div>

      {/* Submit Button */}
      <div className="flex-none px-4 pt-2 pb-4 bottom-dock-safe bg-white border-t border-separator">
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={isSubmitDisabled}
          className={`w-full py-4 rounded-full font-semibold text-base text-white disabled:opacity-40 active:opacity-80 transition-opacity shadow-lg ${
            activeSide === "buy"
              ? "bg-primary shadow-primary/25"
              : "bg-secondary shadow-secondary/25"
          }`}
        >
          {isPending
            ? t("trade.placingOrder")
            : `${activeSide === "buy" ? t("common.long") : t("common.short")} ${baseToken} · ${leverage}× · $${amountNum.toLocaleString()}`}
        </button>

        {validation.reason && !submitError && (
          <p className="text-xs text-center text-amber-600 mt-2">
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
