import { useEffect, useState } from "react";
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
  type OnrampAppState,
  type OnrampBootstrapData,
  type OnrampOrderStatus,
  type OnrampQuote,
} from "../../lib/onramp";

type DepositView = "choice" | "fiat" | "crypto";

function openExternal(url?: string | null) {
  if (!url) return;
  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function isTerminalState(state: OnrampAppState) {
  return state === "success" || state === "failed" || state === "expired";
}

export function DepositPage() {
  const privy = usePrivy() as any;
  const { getAccessToken } = useToken();
  const queryClient = useQueryClient();
  const { user } = privy;
  const { t } = useTranslation();
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
  const [order, setOrder] = useState<OnrampOrderStatus | null>(null);
  const [fiatError, setFiatError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  const address = user?.wallet?.address;
  const email = user?.email?.address ?? null;
  const { data: arbUsdcBalance, isLoading } = useArbitrumUsdcBalance(address);
  const fundWallet = useFundArbitrumUsdc();
  const bridge = useBridgeToHyperliquid();

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
          setOrder(null);
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

        setBootstrapData(nextBootstrap);
        setOrder(nextBootstrap.activeOrder);
        setFiatState(nextBootstrap.state);
        setFiatError(null);

        if (returnExternalOrderId) {
          const statusResponse = await fetchOnrampStatus(accessToken, {
            externalOrderId: returnExternalOrderId,
          });

          if (cancelled) return;

          setOrder(statusResponse.order);
          setFiatState(statusResponse.state);
          setBootstrapData((current) =>
            current
              ? {
                  ...current,
                  state: statusResponse.state,
                  activeOrder: statusResponse.order,
                }
              : current,
          );
        }
      } catch (error) {
        if (cancelled) return;
        setFiatError(
          error instanceof Error
            ? error.message
            : t("deposit.genericFiatError"),
        );
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
    if (view !== "fiat" || !order || isTerminalState(order.appState)) {
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

        setOrder(statusResponse.order);
        setFiatState(statusResponse.state);
        setBootstrapData((current) =>
          current
            ? {
                ...current,
                state: statusResponse.state,
                activeOrder: statusResponse.order,
              }
            : current,
        );

        if (statusResponse.state === "success") {
          void queryClient.invalidateQueries();
        }
      } catch (error) {
        if (!cancelled) {
          setFiatError(
            error instanceof Error
              ? error.message
              : t("deposit.genericFiatError"),
          );
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

  const requestQuote = async () => {
    if (!email) {
      setFiatState("email_required");
      return;
    }

    const amount = Number(fiatAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFiatError(t("deposit.invalidFiatAmount"));
      return;
    }

    setIsQuoting(true);
    setFiatState("quote_loading");
    setFiatError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(t("deposit.authRequired"));
      }

      const response = await fetchOnrampQuote(accessToken, amount);
      setQuote(response.quote);
      setFiatState(response.state);
    } catch (error) {
      setFiatError(
        error instanceof Error
          ? error.message
          : t("deposit.genericFiatError"),
      );
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

    const amount = Number(fiatAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFiatError(t("deposit.invalidFiatAmount"));
      return;
    }

    setIsCheckingOut(true);
    setFiatState("checkout_pending");
    setFiatError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error(t("deposit.authRequired"));
      }

      const response = await checkoutOnramp(accessToken, amount);
      setOrder(response.order);
      setFiatState(response.state);
      setBootstrapData((current) =>
        current
          ? {
              ...current,
              state: response.state,
              activeOrder: response.order,
            }
          : current,
      );
      if (response.order.invoiceUrl) {
        openExternal(response.order.invoiceUrl);
      }
    } catch (error) {
      setFiatError(
        error instanceof Error
          ? error.message
          : t("deposit.genericFiatError"),
      );
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
      setOrder(response.order);
      setFiatState(response.state);
      if (response.state === "success") {
        void queryClient.invalidateQueries();
      }
    } catch (error) {
      setFiatError(
        error instanceof Error
          ? error.message
          : t("deposit.genericFiatError"),
      );
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const handleFiatAmountChange = (value: string) => {
    setFiatAmount(value);
    setQuote(null);
    if (!order || isTerminalState(order.appState)) {
      setFiatState(email ? "ready" : "email_required");
    }
  };

  const verificationLabel =
    bootstrapData?.kycStatus === "verified_local"
      ? t("deposit.verifiedEmail")
      : t("deposit.pendingVerification");
  const destinationAddress =
    bootstrapData?.walletAddress ?? address ?? t("deposit.connectWallet");
  const isEmailRequired = !email || fiatState === "email_required";
  const showQuoteCard = Boolean(quote);
  const showOrderCard = Boolean(order);
  const canRequestQuote =
    !isEmailRequired && !isBootstrapping && !isQuoting && !isCheckingOut;
  const canCheckout = Boolean(
    quote &&
      !isEmailRequired &&
      !isBootstrapping &&
      !isCheckingOut &&
      !order,
  );

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
                  d="M3 7.5A2.5 2.5 0 015.5 5h13A2.5 2.5 0 0121 7.5v9A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M3 9h18M16 14h2"
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
                  d="M12 3v18M7 8.5h6a3 3 0 010 6H9a3 3 0 000 6h8"
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
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted">{t("deposit.network")}</p>
                <p className="mt-1 font-semibold text-foreground">
                  {bootstrapData?.service.network ?? t("deposit.arbitrumOne")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">{t("deposit.asset")}</p>
                <p className="mt-1 font-semibold text-foreground">
                  {bootstrapData?.service.symbol ?? "RUB-USDC"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted">{t("deposit.destinationWallet")}</p>
              <div className="mt-2 rounded-2xl bg-surface px-4 py-3 font-mono text-sm text-foreground break-all">
                {destinationAddress}
              </div>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted">{t("deposit.linkedEmail")}</p>
                <p className="mt-1 text-sm text-foreground">
                  {email ?? t("common.notLinked")}
                </p>
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
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void requestQuote()}
                disabled={!canRequestQuote}
                className="rounded-full bg-surface px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-50"
              >
                {isQuoting ? t("deposit.loadingQuote") : t("deposit.getQuote")}
              </button>
              <button
                type="button"
                onClick={() => void startCheckout()}
                disabled={!canCheckout}
                className="rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isCheckingOut
                  ? t("deposit.creatingOrder")
                  : t("deposit.continueToPayment")}
              </button>
            </div>
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
              {order.invoiceUrl && !isTerminalState(order.appState) && (
                <button
                  type="button"
                  onClick={() => openExternal(order.invoiceUrl)}
                  className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white"
                >
                  {t("deposit.openPaymentPage")}
                </button>
              )}
              {isTerminalState(order.appState) && (
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
