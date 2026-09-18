import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PrivyProvider,
  usePrivy,
  useToken,
  type User,
} from "@privy-io/react-auth";
import { useTranslation } from "react-i18next";
import { arbitrum } from "viem/chains";
import {
  clearStoredAgentKey,
  useMarketData,
  useSetupTrading,
} from "@repo/hyperliquid-sdk";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { bootstrapProfile, recordAttribution } from "./lib/profile";
import { getFirstTouch } from "./lib/attribution";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { AgentRecoverySheet } from "./components/AgentRecoverySheet";
import { PortfolioRangeProvider } from "./hooks/usePortfolioRange";
import { log } from "./lib/logger";
import { reportClientError, toReportableError } from "./lib/error-reporting";
import { teardownStartupShell } from "./lib/startup";
import "./index.css";
import "./lib/i18n";

interface PrivyWithTelegram {
  ready: boolean;
  authenticated: boolean;
  user: User | null;
  loginWithTelegram: () => Promise<void>;
}

function lazyNamedModule<T extends Record<string, React.ComponentType<any>>>(
  loader: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as React.ComponentType<any> };
  });
}

const PositionsPage = lazyNamedModule(
  () => import("./pages/PositionsPage"),
  "PositionsPage",
);
const PointsPage = lazyNamedModule(
  () => import("./pages/PointsPage"),
  "PointsPage",
);
const AccountPage = lazyNamedModule(
  () => import("./pages/AccountPage"),
  "AccountPage",
);
const CoinDetailPage = lazyNamedModule(
  () => import("./pages/CoinDetailPage"),
  "CoinDetailPage",
);
const TradePage = lazyNamedModule(
  () => import("./pages/TradePage"),
  "TradePage",
);
const DepositPage = lazyNamedModule(
  () => import("./pages/account/DepositPage"),
  "DepositPage",
);
const WithdrawPage = lazyNamedModule(
  () => import("./pages/account/WithdrawPage"),
  "WithdrawPage",
);
// Swap enabled — needed to convert USDC → USDH/USDT/USDE for HIP3 markets
const SwapPage = lazyNamedModule(
  () => import("./pages/account/SwapPage"),
  "SwapPage",
);
const AccountSettingsMenu = lazyNamedModule(
  () => import("./pages/account/AccountSettingsMenu"),
  "AccountSettingsMenu",
);
const ApprovalsPage = lazyNamedModule(
  () => import("./pages/account/ApprovalsPage"),
  "ApprovalsPage",
);
const PersonalInfoPage = lazyNamedModule(
  () => import("./pages/account/PersonalInfoPage"),
  "PersonalInfoPage",
);
const NotificationsPage = lazyNamedModule(
  () => import("./pages/account/NotificationsPage"),
  "NotificationsPage",
);
const PrivateKeyPage = lazyNamedModule(
  () => import("./pages/account/PrivateKeyPage"),
  "PrivateKeyPage",
);
const LanguagePage = lazyNamedModule(
  () => import("./pages/account/LanguagePage"),
  "LanguagePage",
);
const SupportPage = lazyNamedModule(
  () => import("./pages/account/SupportPage"),
  "SupportPage",
);
const LegalPage = lazyNamedModule(
  () => import("./pages/account/LegalPage"),
  "LegalPage",
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});

// One fallback covers Positions, Points, Trade, Coin detail and every Account
// sub-page while their chunk loads, so it deliberately imitates none of them.
// The previous version was shaped like the Account page — a hero card, two list
// cards, then 2/2/3 grids — and promised the wrong layout to every route but
// that one.
//
// What these screens do share is a page header and a stack of cards, and that
// is all this claims. The header block matches the real eyebrow-to-title
// spacing rather than approximating it.
function RouteFallback() {
  return (
    <div className="editorial-page px-4 py-5">
      <div className="animate-pulse">
        <div className="h-3 w-20 rounded bg-surface" />
        <div className="mt-2 h-7 w-44 rounded bg-surface" />

        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-24 rounded-[18px] border border-border bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Fire-and-forget prefetch for the three trading-approval queries.
// Mounting useSetupTrading is enough — it triggers useBuilderFeeApproval,
// useAgentApprovalStatus, and useUnifiedAccountApproval in one call.
// Renders null so it has zero visual impact.
function TradingSetupPrefetcher() {
  useSetupTrading();
  return null;
}

function StartupShellController({
  authSettled,
  ready,
}: {
  authSettled: boolean;
  ready: boolean;
}) {
  const {
    data: markets,
    isError: marketsError,
    isLoading: marketsLoading,
  } = useMarketData();
  const startupShellTornDownRef = React.useRef(false);

  useEffect(() => {
    if (startupShellTornDownRef.current) {
      return;
    }

    const marketBootstrapSettled =
      !marketsLoading && (marketsError || Boolean(markets));

    if (!ready || !authSettled || !marketBootstrapSettled) {
      return;
    }

    startupShellTornDownRef.current = true;
    teardownStartupShell();
  }, [authSettled, markets, marketsError, marketsLoading, ready]);

  return null;
}

export function TelegramAuthGate({ children }: { children: React.ReactNode }) {
  const privy = usePrivy() as unknown as PrivyWithTelegram;
  const { getAccessToken } = useToken();
  const { t } = useTranslation();
  const { ready, authenticated, user, loginWithTelegram } = privy;
  const [loginError, setLoginError] = useState<string | null>(null);

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);
  const authSettled = !isTMA || authenticated || loginError != null;

  // Diagnostic: when Privy never becomes ready the app sits on the spinner
  // with nothing thrown to trace, and a console inside Telegram is
  // unreachable. Report the stall once, with the Telegram context, so a
  // webview-only failure shows up in the server logs next to client crashes.
  // The report carries navigator.userAgent, which names the webview.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => {
      reportClientError({
        kind: "window-error",
        message:
          `[diag] privy-not-ready-after-12s isTMA=${isTMA} ` +
          `hasTelegramWebApp=${Boolean(window.Telegram?.WebApp)} ` +
          `hasInitData=${Boolean(window.Telegram?.WebApp?.initData)}`,
      });
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [isTMA, ready]);

  useEffect(() => {
    if (!ready || authenticated || !isTMA) return;

    setLoginError(null);
    loginWithTelegram().catch((err: unknown) => {
      log.warn("[auth] Telegram login failed", { error: err });
      // Server-visible for the same reason the stall above is reported.
      const { message, stack } = toReportableError(err);
      reportClientError({
        kind: "window-error",
        message: `[diag] loginWithTelegram failed: ${message}`,
        stack,
      });
      setLoginError(t("errors.loginFailed"));
    });
  }, [authenticated, isTMA, loginWithTelegram, ready, t]);

  useEffect(() => {
    if (!ready || !authenticated) return;

    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          return;
        }

        await bootstrapProfile(accessToken);

        // Persist the first touch this session captured. Its own try so a
        // failed attribution write never blocks the profile bootstrap above,
        // and only when there is something to record.
        const firstTouch = getFirstTouch();
        if (firstTouch) {
          try {
            await recordAttribution(accessToken, firstTouch);
          } catch (error) {
            log.warn("[auth] Attribution record failed", { error });
          }
        }
      } catch (error) {
        log.warn("[auth] Profile bootstrap failed", {
          error,
          privyUserId: user?.id,
        });
      }
    })();
  }, [authenticated, getAccessToken, ready, user]);

  // Drop every cached query when the signed-in account changes.
  //
  // Account queries are keyed by Privy user id, which is enough to stop one
  // account reading another's cache entry, but the entries themselves would
  // otherwise linger in memory for the rest of the session. Clearing on change
  // means a sign-out leaves nothing behind.
  const previousUserId = useRef<string | null>(null);
  const previousWallet = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;

    const currentUserId = authenticated ? (user?.id ?? null) : null;
    const accountChanged =
      previousUserId.current !== null &&
      previousUserId.current !== currentUserId;
    if (accountChanged) {
      queryClient.clear();
      // The end of an account's session on this device is the moment its
      // trading key must stop existing here: the key can sign orders for up
      // to 180 days and localStorage outlives the session, so the next person
      // holding the device must not inherit it. Deleting the key is enough —
      // the on-chain approval is inert without it, and the next login's
      // approval replaces the named agent anyway. An on-chain revoke here
      // would demand a signature from a user who is already gone.
      if (previousWallet.current) {
        clearStoredAgentKey(previousWallet.current);
      }
    }
    previousUserId.current = currentUserId;
    if (currentUserId === null) {
      previousWallet.current = null;
    } else if (user?.wallet?.address) {
      // Same login, different wallet is the same boundary: the departing
      // wallet's key must not linger just because the Privy user stayed.
      if (
        !accountChanged &&
        previousWallet.current &&
        previousWallet.current !== user.wallet.address
      ) {
        clearStoredAgentKey(previousWallet.current);
      }
      // The embedded wallet can arrive a beat after the user id; keep the
      // last known address until the new one exists.
      previousWallet.current = user.wallet.address;
    }
  }, [authenticated, ready, user?.id, user?.wallet?.address]);

  if (!ready) {
    return (
      <div className="tg-root-height bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
      </div>
    );
  }

  if (loginError) {
    return (
      <div className="tg-root-height bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-negative">{loginError}</p>
        <button
          className="editorial-button-primary"
          onClick={() => {
            setLoginError(null);
            loginWithTelegram().catch((err: unknown) => {
              log.warn("[auth] Telegram login retry failed", { error: err });
              setLoginError(t("errors.loginFailed"));
            });
          }}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <>
      <StartupShellController authSettled={authSettled} ready={ready} />
      <TradingSetupPrefetcher />
      {children}
    </>
  );
}

function AppContent() {
  return (
    <BrowserRouter>
      <TelegramAuthGate>
        <Layout>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/positions" element={<PositionsPage />} />
              <Route path="/points" element={<PointsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/account/deposit" element={<DepositPage />} />
              <Route path="/account/withdraw" element={<WithdrawPage />} />
              {/* Swap enabled for USDC → USDH/USDT/USDE (required for HIP3 markets) */}
              <Route path="/account/swap" element={<SwapPage />} />
              <Route
                path="/account/settings"
                element={<AccountSettingsMenu />}
              />
              <Route
                path="/account/settings/approvals"
                element={<ApprovalsPage />}
              />
              <Route
                path="/account/settings/personal"
                element={<PersonalInfoPage />}
              />
              <Route
                path="/account/settings/notifications"
                element={<NotificationsPage />}
              />
              <Route
                path="/account/settings/private-key"
                element={<PrivateKeyPage />}
              />
              <Route
                path="/account/settings/language"
                element={<LanguagePage />}
              />
              <Route
                path="/account/settings/support"
                element={<SupportPage />}
              />
              <Route path="/account/settings/legal" element={<LegalPage />} />
              <Route path="/coin/:symbol" element={<CoinDetailPage />} />
              <Route path="/trade/:symbol" element={<TradePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
          {/* Above the routes, not inside one: a refused trading action can
              come from any screen, and the recovery it needs is the same. */}
          <AgentRecoverySheet />
        </Layout>
      </TelegramAuthGate>
    </BrowserRouter>
  );
}

function App() {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div style={{ color: "red", padding: 40, fontSize: 24 }}>
        VITE_PRIVY_APP_ID is undefined! Check Vercel env vars.
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <PrivyProvider
        appId={appId}
        config={{
          defaultChain: arbitrum,
          supportedChains: [arbitrum],
          // Telegram only. The app runs inside a Telegram mini app and logs in
          // seamlessly from that context; email and sms were configured login
          // UIs no one reaches here. Deposits are unaffected — every deposit
          // path (Privy funding, the HL bridge, the fiat on-ramp, a direct
          // send to the address) depends on the embedded wallet below, not on
          // any contact login method. Privy's own *funding* methods are
          // configured in the Privy dashboard, independently of this list.
          loginMethods: ["telegram"],
          appearance: {
            theme: "light",
            accentColor: "#3b82f6",
          },
          embeddedWallets: {
            // v3 nests wallet creation per chain family rather than declaring
            // it once. The policy is unchanged: a wallet is created only for a
            // user who does not already have one, so nobody gains a second
            // address — which is the address their whole Hyperliquid account,
            // agent approval and reward history are keyed to.
            ethereum: {
              createOnLogin: "users-without-wallets",
            },
          },
          // `externalWallets.coinbaseWallet` went with the upgrade rather than
          // being ported. Its shape changed, and `loginMethods` above offers
          // email, sms and telegram only — there is no path in this app that
          // connects an external wallet, so the block was configuring a screen
          // nobody can reach.
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PortfolioRangeProvider>
            <ToastProvider>
              <AppContent />
            </ToastProvider>
          </PortfolioRangeProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </ErrorBoundary>
  );
}

export default App;
