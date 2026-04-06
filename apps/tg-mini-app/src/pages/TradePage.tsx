import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useTranslation } from "react-i18next";
import {
  getMarketBaseAsset,
  getMarketDisplayName,
  useMarketData,
  useMids,
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
import { formatPrice } from "../utils/format";

function formatUsdInput(value: number): string {
  const truncated = Math.floor(value * 100) / 100;
  if (Number.isNaN(truncated) || truncated <= 0) return "0";
  return truncated
    .toFixed(2)
    .replace(/\.00$/u, "")
    .replace(/(\.\d)0$/u, "$1");
}

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50];

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
  const [leverage, setLeverage] = useState(1);
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

  const { data: markets } = useMarketData();
  const { data: mids } = useMids();
  const { data: userState } = useUserState();
  const {
    isReady: tradingReady,
    isExpired: tradingExpired,
    setup: tradingSetup,
  } = useSetupTrading();
  const placeOrder = usePlaceOrder();
  const upsertPositionProtection = useUpsertPositionProtection();

  const selectedPerpMarket = useMemo(
    () =>
      (markets?.perp as Array<any> | undefined)?.find(
        (market) => market.name === symbol,
      ) ?? null,
    [markets, symbol],
  );

  // Spot disabled — all markets are perp
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

  const currentPrice = mids?.[symbol] ? parseFloat(mids[symbol]) : null;
  const amountNum = parseFloat(amount) || 0;
  const limitPriceNum = parseFloat(limitPrice) || 0;
  const positionDirection: PositionDirection =
    side === "buy" ? "long" : "short";

  const availableMarginUsd = useMemo(
    () => (isPerp ? (userState?.withdrawable ?? 0) : 0),
    [isPerp, userState?.withdrawable],
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
        Math.min(Math.max(nextPositionLeverage ?? 1, 1), maxLeverage),
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

    return validateOrderInput(
      {
        coin: symbol,
        side,
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
    side,
    symbol,
    validationAvailableBalance,
    validationReferencePrice,
  ]);

  const liquidationPx = useMemo(() => {
    if (!isPerp || amountNum === 0 || !currentPrice || leverage <= 1)
      return null;
    return side === "buy"
      ? currentPrice * (1 - 1 / leverage)
      : currentPrice * (1 + 1 / leverage);
  }, [amountNum, currentPrice, isPerp, leverage, side]);

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

  const needsSetup = authenticated && (!tradingReady || tradingExpired);

  useEffect(() => {
    const walletAddress = user?.wallet?.address ?? null;

    if (needsSetup) {
      if (setupWalletRef.current !== walletAddress || !setupVisible) {
        tradingSetup.reset();
      }
      setupWalletRef.current = walletAddress;
      setSetupVisible(true);
      return;
    }

    if (!authenticated) {
      setupWalletRef.current = null;
      tradingSetup.reset();
      setSetupVisible(false);
      return;
    }

    if (!tradingSetup.isSuccess) {
      setSetupVisible(false);
    }
  }, [
    authenticated,
    needsSetup,
    setupVisible,
    tradingSetup,
    tradingSetup.isSuccess,
    user?.wallet?.address,
  ]);

  const ctaLabel =
    side === "buy"
      ? t("trade.longCta", { name: displayName })
      : t("trade.shortCta", { name: displayName });
  const sideLabel = side === "buy" ? t("common.long") : t("common.short");

  const isPending = placeOrder.isPending || upsertPositionProtection.isPending;
  const isSubmitDisabled = amountNum === 0 || isPending || !validation.isValid;

  const handleAmountChange = (value: string) => {
    setSubmitError(null);
    setAmount(value);
  };

  const handleLimitPriceChange = (value: string) => {
    setSubmitError(null);
    setLimitPrice(value);
  };

  const handleQuickFill = (pct: number) => {
    haptics.light();
    setSubmitError(null);
    setAmount(formatUsdInput(maxPositionUsd * pct));
  };

  const handleLeveragePill = (value: number) => {
    haptics.selection();
    setSubmitError(null);
    setLeverage(value);
  };

  const handleOrderTypeToggle = (value: "market" | "limit") => {
    haptics.light();
    setSubmitError(null);
    setOrderType(value);
    setStep("amount");
  };

  const handleProtectionSubmit = () => {
    haptics.light();
    setProtectionOpen(false);
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

    const order: Order = {
      coin: symbol,
      side,
      sizeUsd: amountNum,
      orderType,
      reduceOnly: false,
      leverage,
      marketType: "perp" as const,
      ...(orderType === "limit" && { limitPx: limitPriceNum, tif }),
    };

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

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex-none px-4 py-3 flex items-center justify-between border-b border-separator bg-white">
        <div className="flex items-center gap-2.5">
          <TokenIcon coin={baseToken} size={32} />
          <div>
            <span className="font-bold text-foreground">{displayName}</span>
            <span className="text-xs text-gray-400 ml-1">
              {t("trade.perp")}
            </span>
          </div>
          {currentPrice != null && (
            <span className="text-sm font-medium text-gray-600 tabular-nums ml-1">
              {formatPrice(currentPrice)}
            </span>
          )}
        </div>

        <div className="flex bg-surface rounded-lg p-0.5 gap-0.5">
          {(["market", "limit"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => handleOrderTypeToggle(value)}
              aria-pressed={orderType === value}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                orderType === value
                  ? "bg-white shadow text-foreground"
                  : "text-gray-500"
              }`}
            >
              {value === "market"
                ? t("trade.orderTypeMarket")
                : t("trade.orderTypeLimit")}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-lg text-gray-500 active:bg-gray-100 transition-colors"
          aria-label={t("trade.ariaOrderSettings")}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 flex flex-col items-center gap-5">
        <div className="flex flex-col items-center">
          <div className="text-6xl font-bold text-foreground tabular-nums tracking-tight">
            {step === "amount"
              ? `$${amountNum === 0 ? "0" : amount}`
              : limitPriceNum === 0
                ? "$0"
                : `$${limitPrice}`}
          </div>
          {step === "amount" ? (
            <div className="mt-2 text-center text-sm text-gray-400">
              <div>
                {t("trade.availableMargin")}
                {availableMarginUsd.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}
              </div>
              <div>
                {t("trade.maxSize")}
                {maxPositionUsd.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}
                {t("trade.at")}
                {leverage}x
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 mt-2">{t("trade.limitPrice")}</div>
          )}
          {step === "price" && (
            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                setStep("amount");
              }}
              className="text-sm text-primary mt-2 active:opacity-60"
            >
              {t("trade.editAmount")}
            </button>
          )}
        </div>

        {step === "amount" && (
          <div className="flex gap-2">
            {[
              { label: t("trade.qf10"), pct: 0.1 },
              { label: t("trade.qf25"), pct: 0.25 },
              { label: t("trade.qf50"), pct: 0.5 },
              { label: t("trade.qfMax"), pct: 1 },
            ].map(({ label, pct }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleQuickFill(pct)}
                className="px-3.5 py-1.5 rounded-full bg-surface text-sm font-medium text-gray-600 active:bg-gray-200 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {isPerp && step === "amount" && (
          <div className="w-full">
            <div className="text-xs text-gray-400 mb-2 font-medium">
              {t("trade.leverage")}
            </div>
            <div className="flex flex-wrap gap-2">
              {leverageOptions.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleLeveragePill(value)}
                  aria-pressed={leverage === value}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                    leverage === value
                      ? "bg-primary text-white"
                      : "bg-surface text-gray-600 active:bg-gray-200"
                  }`}
                >
                  {value}x
                </button>
              ))}
            </div>
          </div>
        )}

        {isPerp && (
          <button
            type="button"
            onClick={() => {
              haptics.light();
              setProtectionOpen(true);
            }}
            className="w-full rounded-[24px] border border-separator bg-white px-4 py-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 active:bg-surface"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface text-foreground"
                    aria-hidden="true"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 3l7 4v5c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V7l7-4z"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {t("trade.protection")}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {orderType === "limit"
                        ? t("trade.availableAfterFills")
                        : protectionSummary.length > 0
                          ? t("trade.reduceOnlySlTp")
                          : t("trade.optionalSlTp")}
                    </p>
                  </div>
                </div>

                {protectionSummary.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {protectionSummary.map((label) => (
                      <span
                        key={label}
                        className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-foreground tabular-nums"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <span className="text-sm font-semibold text-primary">
                {protectionSummary.length > 0 ? t("common.edit") : t("common.add")}
              </span>
            </div>
          </button>
        )}
      </div>

      <div className="flex-none pb-1">
        <NumPad
          value={step === "amount" ? amount : limitPrice}
          onChange={
            step === "amount" ? handleAmountChange : handleLimitPriceChange
          }
          maxDecimals={step === "amount" ? 2 : 8}
        />
      </div>

      <div className="flex-none px-4 pt-2 pb-4 bottom-dock-safe bg-white border-t border-separator">
        {orderType === "limit" && step === "amount" ? (
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={isSubmitDisabled}
            className="w-full py-4 rounded-xl font-semibold text-sm bg-primary text-white disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            {t("trade.setPrice")}
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={isSubmitDisabled}
            className={`w-full py-4 rounded-xl font-semibold text-sm text-white disabled:opacity-40 active:opacity-80 transition-opacity ${
              side === "buy" ? "bg-primary" : "bg-secondary"
            }`}
          >
            {isPending ? t("trade.placingOrder") : ctaLabel}
          </button>
        )}

        {liquidationPx != null && (
          <p className="text-xs text-center text-gray-400 mt-1.5">
            {t("trade.liquidationAt")}{formatPrice(liquidationPx)}
          </p>
        )}
        {isPerp && protectionEnabled && orderType === "limit" && (
          <p className="mt-1.5 text-center text-xs text-amber-600">
            {t("trade.addProtectionAfterFills")}
          </p>
        )}
        {validation.reason && !submitError && (
          <p className="text-xs text-center text-amber-600 mt-1.5">
            {validation.reason}
          </p>
        )}
        {submitError && (
          <p className="text-xs text-center text-negative mt-1.5">
            {submitError}
          </p>
        )}
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSettingsOpen(false)}
            aria-label={t("trade.ariaCloseOrderSettings")}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-settings-title"
            className="relative mt-auto bg-white rounded-t-2xl px-4 pt-4 pb-8 animate-slide-up"
          >
            <div className="flex justify-center mb-5">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            <h3
              id="order-settings-title"
              className="text-base font-bold text-foreground mb-5"
            >
              {t("trade.orderSettings")}
            </h3>

            <div className="mb-3 text-sm font-medium text-gray-500">
              {t("trade.timeInForce")}
            </div>
            <div className="flex gap-2 mb-6">
              {(
                [
                  { key: "Gtc", label: t("trade.gtc"), desc: t("trade.goodTillCancelled") },
                  { key: "Alo", label: t("trade.alo"), desc: t("trade.addLiquidityOnly") },
                  { key: "Ioc", label: t("trade.ioc"), desc: t("trade.immediateOrCancel") },
                ] as const
              ).map(({ key, label, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSubmitError(null);
                    setTif(key);
                    haptics.selection();
                  }}
                  aria-pressed={tif === key}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                    tif === key
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-600 border-gray-200"
                  }`}
                >
                  <div>{label}</div>
                  <div
                    className={`text-xs font-normal mt-0.5 ${tif === key ? "text-blue-100" : "text-gray-400"}`}
                  >
                    {desc}
                  </div>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                haptics.light();
              }}
              className="w-full py-3.5 rounded-xl bg-primary text-white font-semibold text-sm active:opacity-80 transition-opacity"
            >
              {t("trade.applyToTrade")}
            </button>
          </div>
        </div>
      )}

      <ProtectionSheet
        isOpen={protectionOpen}
        onClose={() => setProtectionOpen(false)}
        onSubmit={handleProtectionSubmit}
        draft={protectionDraft}
        onChange={setProtectionDraft}
        direction={positionDirection}
        marketLabel={displayName}
        currentPrice={currentPrice}
        referencePrice={
          orderType === "limit" ? limitPriceNum || currentPrice : currentPrice
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
        isExpired={tradingExpired}
      />
    </div>
  );
}
