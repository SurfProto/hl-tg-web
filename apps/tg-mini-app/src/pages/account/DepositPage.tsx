import { useEffect, useRef, useState } from "react";
import { usePrivy, useToken } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useArbitrumUsdcBalance,
  useBridgeToHyperliquid,
  useFundArbitrumUsdc,
} from "@repo/hyperliquid-sdk";

import {
  bootstrapOnramp,
  checkoutOnramp,
  fetchOnrampQuote,
  fetchOnrampStatus,
  getActiveOnrampOrder,
  isOnrampQuoteCurrent,
  isOnrampUserVerified,
  isTerminalOnrampState,
  mergeRecentOnrampOrders,
  validateOnrampAmount,
  type OnrampAppState,
  type OnrampBootstrapData,
  type OnrampOrderStatus,
  type OnrampQuote,
  type OnrampQuoteRequest,
} from "../../lib/onramp";
import { useToast } from "../../components/Toast";

type DepositView = "choice" | "fiat" | "crypto";

function openExternal(url?: string | null) {
  if (!url) return;
  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function isValidTrc20Address(addr: string): boolean {
  return /^T[a-zA-Z0-9]{33}$/.test(addr);
}

function getDisplayTimestamp(timestamp?: string | null) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function getAmountValidationMessage(
  validation: ReturnType<typeof validateOnrampAmount>,
  limits: OnrampBootstrapData["limits"],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (validation.ok === true) return null;

  if (validation.code === "below_minimum" && limits) {
    return t("deposit.amountBelowMinimum", {
      amount: limits.minAmount,
      currency: limits.currency,
    });
  }
  if (validation.code === "above_maximum" && limits) {
    return t("deposit.amountAboveMaximum", {
      amount: limits.maxAmount,
      currency: limits.currency,
    });
  }

  return t("deposit.invalidFiatAmount");
}

function getToastTypeForStatus(state: OnrampAppState): "success" | "error" | "info" | null {
  if (state === "success" || state === "quote_ready") {
    return "success";
  }
  if (state === "failed" || state === "expired") {
    return "error";
  }
  if (
    state === "quote_loading" ||
    state === "checkout_pending" ||
    state === "invoice_pending" ||
    state === "payment_pending" ||
    state === "processing"
  ) {
    return "info";
  }

  return null;
}

export function DepositPage() {
  const privy = usePrivy() as any;
  const { getAccessToken } = useToken();
  const queryClient = useQueryClient();
  const { user } = privy;
  const { t } = useTranslation();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const lastToastedStateRef = useRef<OnrampAppState | null>(null);
  const returnExternalOrderId =
    new URLSearchParams(window.location.search).get("onramp_external_order_id");

  const [view, setView] = useState<DepositView>(
    returnExternalOrderId ? "fiat" : "choice",
  );
  const [bridgeAmount, setBridgeAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const [fiatAmount, setFiatAmount] = useState("1000");
  const [fiatState, setFiatState] = useState<OnrampAppState>(
    user?.email?.address ? "ready" : "email_required",
  );
  const [bootstrapData, setBootstrapData] =
    useState<OnrampBootstrapData | null>(null);
  const [quote, setQuote] = useState<OnrampQuote | null>(null);
  const [quoteRequest, setQuoteRequest] = useState<OnrampQuoteRequest | null>(null);
  const [order, setOrder] = useState<OnrampOrderStatus | null>(null);
  const [recentOrders, setRecentOrders] = useState<OnrampOrderStatus[]>([]);
  const [fiatError, setFiatError] = useState<string | null>(null);
  const [tronAddress, setTronAddress] = useState("");
  const [addressMode, setAddressMode] = useState<"privy" | "trc20">("trc20");
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  const address = user?.wallet?.address;
  const email = user?.email?.address ?? null;
  const { data: arbUsdcBalance, isLoading } = useArbitrumUsdcBalance(address);
  const fundWallet = useFundArbitrumUsdc();
  const bridge = useBridgeToHyperliquid();

  useEffect(() => {
    if (view !== "fiat") return;

    const toastType = getToastTypeForStatus(fiatState);
    if (!toastType || lastToastedStateRef.current === fiatState) {
      return;
    }

    lastToastedStateRef.current = fiatState;
    const message = t(`deposit.toast.${fiatState}`);
    toastRef.current[toastType](message);
  }, [fiatState, t, view]);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    if (view !== "fiat") return;

    let cancelled = false;

    const runBootstrap = async () => {
      if (!email) {
        if (!cancelled) {
          setBootstrapData(null);
          setQuote(null);
          setQuoteRequest(null);
          setOrder(null);
          setRecentOrders([]);
          setFiatState("email_required");
          setFiatError(null);
        }
        return;
      }

      setIsBootstrapping(true);
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error(t("deposit.authRequired"));
        }

        const nextBootstrap = await bootstrapOnramp(accessToken, {
          email,
          walletAddress: address ?? null,
        });

        if (cancelled) return;

        const nextActiveOrder = getActiveOnrampOrder(nextBootstrap.activeOrder);
        setBootstrapData({ ...nextBootstrap, activeOrder: nextActiveOrder });
        setOrder(nextActiveOrder);
        setRecentOrders(nextBootstrap.recentOrders ?? []);
        setFiatState(nextBootstrap.state);
        setFiatError(null);

        if (returnExternalOrderId) {
          const statusResponse = await fetchOnrampStatus(accessToken, {
            externalOrderId: returnExternalOrderId,
          });

          if (cancelled) return;

          const returnedActiveOrder = getActiveOnrampOrder(statusResponse.order);
          setOrder(returnedActiveOrder);
          setFiatState(returnedActiveOrder ? statusResponse.state : "ready");
          if (!returnedActiveOrder) {
            setQuote(null);
            setQuoteRequest(null);
            setRecentOrders((current) => mergeRecentOnrampOrders(current, statusResponse.order));
          }
          setBootstrapData((current) =>
            current
              ? {
                  ...current,
                  state: returnedActiveOrder ? statusResponse.state : "ready",
                  activeOrder: returnedActiveOrder,
                  recentOrders: returnedActiveOrder
                    ? current.recentOrders
                    : mergeRecentOnrampOrders(current.recentOrders, statusResponse.order),
                }
              : current,
          );
        }
      } catch (error) {
        if (cancelled) return;
        setFiatFailure(error instanceof Error ? error.message : t("deposit.genericFiatError"));
        setFiatState(email ? "ready" : "email_required");
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    void runBootstrap();

    return () => {
      cancelled = true;
    };
  }, [address, email, getAccessToken, returnExternalOrderId, t, view]);

  useEffect(() => {
    if (view !== "fiat" || !order || isTerminalOnrampState(order.appState)) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return;

        const statusResponse = await fetchOnrampStatus(accessToken, {
          orderId: order.id,
          externalOrderId: order.externalOrderId,
        });

        if (cancelled) return;

        const nextActiveOrder = getActiveOnrampOrder(statusResponse.order);
        setOrder(nextActiveOrder);
        setFiatState(nextActiveOrder ? statusResponse.state : "ready");
        if (!nextActiveOrder) {
          setQuote(null);
          setQuoteRequest(null);
          setRecentOrders((current) => mergeRecentOnrampOrders(current, statusResponse.order));
        }
        setBootstrapData((current) =>
          current
            ? {
                ...current,
                state: nextActiveOrder ? statusResponse.state : "ready",
                activeOrder: nextActiveOrder,
                recentOrders: nextActiveOrder
                  ? current.recentOrders
                  : mergeRecentOnrampOrders(current.recentOrders, statusResponse.order),
              }
            : current,
        );

        if (statusResponse.state === "success") {
          void queryClient.invalidateQueries();
        }
      } catch (error) {
        if (!cancelled) {
          setFiatFailure(error instanceof Error ? error.message : t("deposit.genericFiatError"));
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getAccessToken, order, queryClient, t, view]);

  const isTrc20 = bootstrapData?.service.network === "TRC20";
  const resolvedPayoutAddress = addressMode === "privy" ? (address ?? null) : tronAddress || null;
  const onrampLimits = bootstrapData?.limits ?? null;
  const amountValidation = validateOnrampAmount(fiatAmount, onrampLimits);

  const setFiatFailure = (message: string) => {
    setFiatError(message);
    toastRef.current.error(message);
  };

  useEffect(() => {
    setQuote(null);
    setQuoteRequest(null);
  }, [resolvedPayoutAddress]);

  const requestQuote = async () => {
    if (!email) {
      setFiatState("email_required");
      return;
    }

    if (isTrc20 && addressMode === "trc20" && !isValidTrc20Address(tronAddress)) {
      setFiatFailure(t("deposit.trc20AddressInvalid"));
      return;
    }

    if (!amountValidation.ok) {
      setFiatFailure(getAmountValidationMessage(amountValidation, onrampLimits, t) ?? t("deposit.invalidFiatAmount"));
      return;
    }

    const { amount } = amountValidation;
    setIsQuoting(true);
    setFiatState("quote_loading");
    setFiatError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(t("deposit.authRequired"));
      }

      if (resolvedPayoutAddress !== bootstrapData?.walletAddress) {
        const updated = await bootstrapOnramp(accessToken, { email, walletAddress: resolvedPayoutAddress });
        const updatedActiveOrder = getActiveOnrampOrder(updated.activeOrder);
        setBootstrapData({ ...updated, activeOrder: updatedActiveOrder });
        setOrder(updatedActiveOrder);
        setRecentOrders(updated.recentOrders ?? []);
      }

      const response = await fetchOnrampQuote(accessToken, amount);
      setQuote(response.quote);
      setQuoteRequest({ amount, walletAddress: resolvedPayoutAddress });
      setFiatState(response.state);
    } catch (error) {
      setFiatFailure(error instanceof Error ? error.message : t("deposit.genericFiatError"));
      setFiatState("ready");
    } finally {
      setIsQuoting(false);
    }
  };

  const startCheckout = async () => {
    if (!email) {
      setFiatState("email_required");
      return;
    }

    if (isTrc20 && addressMode === "trc20" && !isValidTrc20Address(tronAddress)) {
      setFiatFailure(t("deposit.trc20AddressInvalid"));
      return;
    }

    if (!amountValidation.ok) {
      setFiatFailure(getAmountValidationMessage(amountValidation, onrampLimits, t) ?? t("deposit.invalidFiatAmount"));
      return;
    }

    const { amount } = amountValidation;
    setIsCheckingOut(true);
    setFiatState("checkout_pending");
    setFiatError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(t("deposit.authRequired"));
      }

      if (resolvedPayoutAddress !== bootstrapData?.walletAddress) {
        const updated = await bootstrapOnramp(accessToken, { email, walletAddress: resolvedPayoutAddress });
        const updatedActiveOrder = getActiveOnrampOrder(updated.activeOrder);
        setBootstrapData({ ...updated, activeOrder: updatedActiveOrder });
        setOrder(updatedActiveOrder);
        setRecentOrders(updated.recentOrders ?? []);
      }

      const response = await checkoutOnramp(accessToken, amount);
      const nextActiveOrder = getActiveOnrampOrder(response.order);
      setOrder(nextActiveOrder);
      setFiatState(nextActiveOrder ? response.state : "ready");
      if (!nextActiveOrder) {
        setQuote(null);
        setQuoteRequest(null);
        setRecentOrders((current) => mergeRecentOnrampOrders(current, response.order));
      }
      setBootstrapData((current) =>
        current
          ? {
              ...current,
              state: nextActiveOrder ? response.state : "ready",
              activeOrder: nextActiveOrder,
              recentOrders: nextActiveOrder
                ? current.recentOrders
                : mergeRecentOnrampOrders(current.recentOrders, response.order),
            }
          : current,
      );
      if (response.order.invoiceUrl) {
        openExternal(response.order.invoiceUrl);
      }
    } catch (error) {
      setFiatFailure(error instanceof Error ? error.message : t("deposit.genericFiatError"));
      setFiatState("ready");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const refreshStatus = async () => {
    if (!order) return;

    setIsRefreshingStatus(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(t("deposit.authRequired"));
      }

      const response = await fetchOnrampStatus(accessToken, {
        orderId: order.id,
        externalOrderId: order.externalOrderId,
      });
      const nextActiveOrder = getActiveOnrampOrder(response.order);
      setOrder(nextActiveOrder);
      setFiatState(nextActiveOrder ? response.state : "ready");
      if (!nextActiveOrder) {
        setQuote(null);
        setQuoteRequest(null);
        setRecentOrders((current) => mergeRecentOnrampOrders(current, response.order));
      }
      setBootstrapData((current) =>
        current
          ? {
              ...current,
              state: nextActiveOrder ? response.state : "ready",
              activeOrder: nextActiveOrder,
              recentOrders: nextActiveOrder
                ? current.recentOrders
                : mergeRecentOnrampOrders(current.recentOrders, response.order),
            }
          : current,
      );
      if (response.state === "success") {
        void queryClient.invalidateQueries();
      }
    } catch (error) {
      setFiatFailure(error instanceof Error ? error.message : t("deposit.genericFiatError"));
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const handleFiatAmountChange = (value: string) => {
    setFiatAmount(value);
    setQuote(null);
    setQuoteRequest(null);
    if (!order || isTerminalOnrampState(order.appState)) {
      setFiatState(email ? "ready" : "email_required");
    }
  };

  const isVerifiedUser = bootstrapData ? isOnrampUserVerified(bootstrapData.kycStatus) : false;
  const verificationLabel =
    bootstrapData?.kycStatus === "verified_local"
      ? t("deposit.verifiedEmail")
      : bootstrapData?.kycStatus === "verified_kyc"
        ? t("deposit.verifiedKyc")
        : t("deposit.pendingVerification");
  const isEmailRequired = !email || fiatState === "email_required";
  const isTrc20AddressValid =
    !isTrc20 || addressMode === "privy" || isValidTrc20Address(tronAddress);
  const showOrderCard = Boolean(order && !isTerminalOnrampState(order.appState));
  const terminalRecentOrders = recentOrders.filter((recentOrder) =>
    isTerminalOnrampState(recentOrder.appState),
  );
  const amountValidationMessage = getAmountValidationMessage(amountValidation, onrampLimits, t);
  const quoteMatchesCurrentInput = Boolean(
    quote &&
      amountValidation.ok &&
      isOnrampQuoteCurrent(quoteRequest, amountValidation.amount, resolvedPayoutAddress),
  );
  const showQuoteCard = Boolean(quote && quoteMatchesCurrentInput);
  const canUseFiatCta =
    !isEmailRequired &&
    !isBootstrapping &&
    !isQuoting &&
    !isCheckingOut &&
    !order &&
    isTrc20AddressValid &&
    amountValidation.ok;
  const fiatCtaLabel = quoteMatchesCurrentInput
    ? isCheckingOut
      ? t("deposit.creatingOrder")
      : t("deposit.continueToPayment")
    : isQuoting
      ? t("deposit.loadingQuote")
      : t("deposit.getQuote");

  return (
    <div className="min-h-full bg-background px-4 py-5">
      {view === "choice" && (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-foreground">
            {t("deposit.title")}
          </h1>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setView("fiat")}
              className="rounded-2xl border border-separator bg-white p-5 text-left shadow-sm"
            >
              <svg
                className="h-8 w-8 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M4 4h5v5H4V4zm11 0h5v5h-5V4zM4 15h5v5H4v-5z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M15 15h2v2h-2v-2zm4 0h1v5h-5v-1m0-8h2m3 0v2"
                />
              </svg>
              <p className="mt-3 font-semibold text-foreground">
                {t("deposit.buyWithCard")}
              </p>
              <p className="mt-1 text-sm text-muted">
                {t("deposit.fiatDescription")}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setView("crypto")}
              className="rounded-2xl border border-separator bg-white p-5 text-left shadow-sm"
            >
              <svg
                className="h-8 w-8 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M8.5 10.25a3.5 3.5 0 106.25-2.15M9.25 15.9A3.5 3.5 0 1015.5 13.75"
                />
              </svg>
              <p className="mt-3 font-semibold text-foreground">
                {t("deposit.depositCrypto")}
              </p>
              <p className="mt-1 text-sm text-muted">
                {t("deposit.cryptoDescription")}
              </p>
            </button>
          </div>
        </div>
      )}

      {view === "fiat" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView("choice")}
            className="text-sm font-semibold text-primary"
          >
            {t("common.back")}
          </button>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <div className="space-y-2">
              <p className="text-xs text-muted">{t("deposit.destinationWallet")}</p>
              {isTrc20 && (
                <div className="flex rounded-2xl bg-surface p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => { setAddressMode("privy"); setQuote(null); setQuoteRequest(null); }}
                    className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-colors ${addressMode === "privy" ? "bg-white text-foreground shadow-sm" : "text-muted"}`}
                  >
                    {t("deposit.usePrivyWallet")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddressMode("trc20"); setQuote(null); setQuoteRequest(null); }}
                    className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-colors ${addressMode === "trc20" ? "bg-white text-foreground shadow-sm" : "text-muted"}`}
                  >
                    {t("deposit.useExternalTrc20")}
                  </button>
                </div>
              )}
              {(!isTrc20 || addressMode === "privy") && (
                <div className="rounded-2xl bg-surface px-4 py-3 font-mono text-sm text-foreground break-all">
                  {address ?? t("deposit.connectWallet")}
                </div>
              )}
              {isTrc20 && addressMode === "trc20" && (
                <div className="space-y-1">
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    value={tronAddress}
                    onChange={(e) => {
                      setTronAddress(e.target.value.trim());
                      setQuote(null);
                      setQuoteRequest(null);
                    }}
                    placeholder={t("deposit.trc20AddressPlaceholder")}
                    className="w-full rounded-2xl border border-separator bg-surface px-4 py-3 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <p className="text-xs text-muted">{t("deposit.trc20AddressHint")}</p>
                  {tronAddress && !isValidTrc20Address(tronAddress) && (
                    <p className="text-xs text-negative">{t("deposit.trc20AddressInvalid")}</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted">{t("deposit.linkedEmail")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-sm text-foreground">
                    {email ?? t("common.notLinked")}
                  </p>
                  {isVerifiedUser && (
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"
                      aria-label={t("deposit.verifiedBadgeAria")}
                      title={t("deposit.verifiedBadgeAria")}
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.4}
                        aria-hidden="true"
                      >
                        <path d="M4.5 10.5 8 14l7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>
                {email && (
                  <p className="mt-1 text-xs text-muted">{verificationLabel}</p>
                )}
              </div>
              {!email && (
                <button
                  type="button"
                  onClick={() => privy.linkEmail?.()}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  {t("deposit.connectEmail")}
                </button>
              )}
            </div>
          </div>

          {isEmailRequired && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm font-semibold text-foreground">
                {t("deposit.emailRequiredTitle")}
              </p>
              <p className="mt-2 text-sm text-muted">
                {t("deposit.emailRequiredBody")}
              </p>
            </div>
          )}

          {/* TODO: Replace the v1 "pending verification" note with the real provider KYC gate and redirect flow. */}
          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-foreground">
              {t("deposit.fiatAmountLabel")}
            </p>
            <label
              htmlFor="fiat-amount"
              className="text-xs font-medium text-muted"
            >
              {t("deposit.fiatAmountHint")}
            </label>
            <input
              id="fiat-amount"
              type="number"
              name="fiat-amount"
              inputMode="decimal"
              autoComplete="off"
              min="0"
              value={fiatAmount}
              onChange={(event) => handleFiatAmountChange(event.target.value)}
              placeholder="1000"
              disabled={isEmailRequired}
              className="w-full rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
            />
            {onrampLimits && (
              <p className="text-xs text-muted">
                {t("deposit.amountLimits", {
                  min: onrampLimits.minAmount,
                  max: onrampLimits.maxAmount,
                  currency: onrampLimits.currency,
                })}
              </p>
            )}
            {amountValidation.ok === false && fiatAmount.trim() && (
              <p className="text-xs text-negative">{amountValidationMessage}</p>
            )}
            <button
              type="button"
              onClick={() => void (quoteMatchesCurrentInput ? startCheckout() : requestQuote())}
              disabled={!canUseFiatCta}
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {fiatCtaLabel}
            </button>
            <p className="text-xs text-muted">{t("deposit.pendingVerification")}</p>
          </div>

          {showQuoteCard && quote && (
            <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
              <p className="text-sm font-semibold text-foreground">
                {t("deposit.quotePreview")}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">{t("deposit.payin")}</span>
                <span className="font-semibold text-foreground">
                  {quote.payinAmount} {quote.payinCurrency}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">{t("deposit.payout")}</span>
                <span className="font-semibold text-foreground">
                  {quote.payoutAmount} {quote.payoutCurrency}
                </span>
              </div>
              <p className="text-xs text-muted">
                {t("deposit.quoteDisclaimer")}
              </p>
            </div>
          )}

          {showOrderCard && order && (
            <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("deposit.orderStatusLabel")}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {t(`deposit.status.${order.appState}`)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={isRefreshingStatus}
                  className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                >
                  {isRefreshingStatus
                    ? t("deposit.refreshingStatus")
                    : t("deposit.refreshStatus")}
                </button>
              </div>
              <div className="space-y-2 rounded-2xl bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">
                    {t("deposit.orderId")}
                  </span>
                  <span className="font-mono text-xs text-foreground break-all text-right">
                    {order.externalOrderId ?? order.id}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">
                    {t("deposit.payin")}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {order.payinAmount} {order.payinCurrency}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">
                    {t("deposit.payout")}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {order.payoutAmount} {order.payoutCurrency}
                  </span>
                </div>
              </div>
              {order.invoiceUrl && !isTerminalOnrampState(order.appState) && (
                <button
                  type="button"
                  onClick={() => openExternal(order.invoiceUrl)}
                  className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white"
                >
                  {t("deposit.openPaymentPage")}
                </button>
              )}
              {isTerminalOnrampState(order.appState) && (
                <p
                  className={`text-sm ${
                    order.appState === "success"
                      ? "text-positive"
                      : "text-negative"
                  }`}
                >
                  {t(
                    order.appState === "success"
                      ? "deposit.orderSuccess"
                      : order.appState === "expired"
                        ? "deposit.orderExpired"
                        : "deposit.orderFailed",
                  )}
                </p>
              )}
            </div>
          )}

          {terminalRecentOrders.length > 0 && (
            <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
              <p className="text-sm font-semibold text-foreground">
                {t("deposit.orderHistoryTitle")}
              </p>
              <div className="space-y-3">
                {terminalRecentOrders.map((recentOrder) => {
                  const syncedAt = getDisplayTimestamp(recentOrder.lastSyncedAt);

                  return (
                    <div key={recentOrder.id} className="rounded-2xl bg-surface px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p
                            className={`text-sm font-semibold ${
                              recentOrder.appState === "success" ? "text-positive" : "text-negative"
                            }`}
                          >
                            {t(`deposit.status.${recentOrder.appState}`)}
                          </p>
                          {syncedAt && (
                            <p className="mt-1 text-xs text-muted">
                              {t("deposit.orderLastUpdated", { time: syncedAt })}
                            </p>
                          )}
                        </div>
                        <span className="text-right text-sm font-semibold text-foreground">
                          {recentOrder.payoutAmount} {recentOrder.payoutCurrency}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-muted">
                        <div className="flex items-center justify-between gap-3">
                          <span>{t("deposit.payin")}</span>
                          <span className="text-foreground">
                            {recentOrder.payinAmount} {recentOrder.payinCurrency}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>{t("deposit.orderId")}</span>
                          <span className="font-mono text-foreground break-all text-right">
                            {recentOrder.externalOrderId ?? recentOrder.id}
                          </span>
                        </div>
                        {recentOrder.errorMessage && (
                          <p className="text-negative">
                            {t("deposit.orderError", { error: recentOrder.errorMessage })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isBootstrapping && (
            <p className="text-sm text-muted">{t("deposit.loadingOnramp")}</p>
          )}

          {fiatError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-negative">
              {fiatError}
            </div>
          )}
        </div>
      )}

      {view === "crypto" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView("choice")}
            className="text-sm font-semibold text-primary"
          >
            {t("common.back")}
          </button>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{t("deposit.network")}</span>
              <span className="font-semibold text-foreground">
                {t("deposit.arbitrumOne")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">
                {t("deposit.walletBalance")}
              </span>
              <span className="font-semibold text-foreground">
                {isLoading
                  ? t("common.loading")
                  : `${(arbUsdcBalance ?? 0).toFixed(2)} USDC`}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-foreground">
              {t("deposit.step1Title")}
            </p>
            <button
              type="button"
              onClick={() => fundWallet.mutate({ address })}
              disabled={!address || fundWallet.isPending}
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors disabled:opacity-60"
            >
              {fundWallet.isPending
                ? t("deposit.openingFundingModal")
                : t("deposit.addUsdcWithPrivy")}
            </button>
            <div className="rounded-2xl bg-surface px-4 py-3 font-mono text-sm text-foreground break-all">
              {address ?? t("deposit.connectWallet")}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!address}
              className="w-full rounded-full bg-surface px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-50"
            >
              {copied ? t("common.copied") : t("deposit.copyAddress")}
            </button>
          </div>

          <div className="rounded-2xl border border-separator bg-white p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-foreground">
              {t("deposit.step2Title")}
            </p>
            <label
              htmlFor="bridge-amount"
              className="text-xs font-medium text-muted"
            >
              {t("deposit.amountToBridge")}
            </label>
            <div className="flex gap-2">
              <input
                id="bridge-amount"
                type="number"
                name="bridge-amount"
                inputMode="decimal"
                autoComplete="off"
                value={bridgeAmount}
                onChange={(event) => setBridgeAmount(event.target.value)}
                placeholder="0.00"
                className="flex-1 rounded-2xl border border-separator bg-surface px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button
                type="button"
                onClick={() =>
                  setBridgeAmount((arbUsdcBalance ?? 0).toFixed(2))
                }
                className="rounded-2xl bg-surface px-4 py-3 text-sm font-semibold text-primary"
              >
                {t("common.max")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => bridge.mutate({ amount: parseFloat(bridgeAmount) })}
              disabled={
                !bridgeAmount ||
                parseFloat(bridgeAmount) < 5 ||
                bridge.isPending ||
                !address
              }
              className="w-full rounded-full bg-[#111827] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {bridge.isPending
                ? t("deposit.bridging")
                : t("deposit.bridgeButton")}
            </button>
            {bridge.isSuccess && (
              <p className="text-sm text-positive">
                {t("deposit.bridgeSubmitted")}
              </p>
            )}
            {bridge.isError && (
              <p className="text-sm text-negative">
                {bridge.error instanceof Error
                  ? bridge.error.message
                  : t("deposit.bridgeFailed")}
              </p>
            )}
            <p className="text-xs text-muted">{t("deposit.bridgeInfo")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
