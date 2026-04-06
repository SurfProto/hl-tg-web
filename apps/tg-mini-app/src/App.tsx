import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider, usePrivy, type User } from '@privy-io/react-auth';
import { arbitrum } from 'viem/chains';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ensureUser, getTelegramProfile } from './lib/supabase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { PortfolioRangeProvider } from './hooks/usePortfolioRange';
import './index.css';
import './lib/i18n';

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

const PositionsPage = lazyNamedModule(() => import('./pages/PositionsPage'), 'PositionsPage');
const PointsPage = lazyNamedModule(() => import('./pages/PointsPage'), 'PointsPage');
const AccountPage = lazyNamedModule(() => import('./pages/AccountPage'), 'AccountPage');
const CoinDetailPage = lazyNamedModule(() => import('./pages/CoinDetailPage'), 'CoinDetailPage');
const TradePage = lazyNamedModule(() => import('./pages/TradePage'), 'TradePage');
const DepositPage = lazyNamedModule(() => import('./pages/account/DepositPage'), 'DepositPage');
const WithdrawPage = lazyNamedModule(() => import('./pages/account/WithdrawPage'), 'WithdrawPage');
// Transfer disabled (spot-perp transfer, not needed without spot)
// const TransferPage = lazyNamedModule(() => import('./pages/account/TransferPage'), 'TransferPage');
// Swap enabled — needed to convert USDC → USDH/USDT/USDE for HIP3 markets
const SwapPage = lazyNamedModule(() => import('./pages/account/SwapPage'), 'SwapPage');
const AccountSettingsMenu = lazyNamedModule(() => import('./pages/account/AccountSettingsMenu'), 'AccountSettingsMenu');
const PersonalInfoPage = lazyNamedModule(() => import('./pages/account/PersonalInfoPage'), 'PersonalInfoPage');
const NotificationsPage = lazyNamedModule(() => import('./pages/account/NotificationsPage'), 'NotificationsPage');
const PrivateKeyPage = lazyNamedModule(() => import('./pages/account/PrivateKeyPage'), 'PrivateKeyPage');
const LanguagePage = lazyNamedModule(() => import('./pages/account/LanguagePage'), 'LanguagePage');
const SupportPage = lazyNamedModule(() => import('./pages/account/SupportPage'), 'SupportPage');
const LegalPage = lazyNamedModule(() => import('./pages/account/LegalPage'), 'LegalPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteFallback() {
  return (
    <div className="min-h-full bg-background">
      <div className="px-4 pt-6 pb-4">
        <div className="h-6 w-28 rounded-full bg-surface animate-pulse" />
      </div>
      <div className="divide-y divide-separator bg-white border-t border-separator">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3 animate-pulse">
            <div className="h-9 w-9 rounded-full bg-surface flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-3 w-24 rounded-full bg-surface" />
              <div className="h-3 w-16 rounded-full bg-surface" />
            </div>
            <div className="space-y-2 text-right">
              <div className="h-3 w-16 rounded-full bg-surface" />
              <div className="h-3 w-12 rounded-full bg-surface" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TelegramAuthGate({ children }: { children: React.ReactNode }) {
  const privy = usePrivy() as unknown as PrivyWithTelegram;
  const { ready, authenticated, user, loginWithTelegram } = privy;
  const [loginError, setLoginError] = useState<string | null>(null);

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);

  useEffect(() => {
    if (!ready || authenticated || !isTMA) return;

    setLoginError(null);
    loginWithTelegram().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setLoginError(message);
    });
  }, [authenticated, isTMA, loginWithTelegram, ready]);

  useEffect(() => {
    if (!ready || !authenticated) return;

    const telegramProfile = getTelegramProfile();
    void ensureUser({
      telegramId: telegramProfile?.id != null ? String(telegramProfile.id) : undefined,
      privyUserId: user?.id,
      username: telegramProfile?.username ?? user?.telegram?.username ?? user?.email?.address ?? undefined,
      walletAddress: user?.wallet?.address,
    });
  }, [authenticated, ready, user]);

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
        <p className="text-red-500 text-sm">{loginError}</p>
        <button
          className="px-6 py-2 bg-blue-500 text-white rounded-full text-sm font-medium"
          onClick={() => {
            setLoginError(null);
            loginWithTelegram().catch((err: unknown) => {
              const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
              setLoginError(message);
            });
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return <>{children}</>;
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
              {/* Transfer disabled — spot-perp transfer not needed without spot */}
              {/* <Route path="/account/transfer" element={<TransferPage />} /> */}
              {/* Swap enabled for USDC → USDH/USDT/USDE (required for HIP3 markets) */}
              <Route path="/account/swap" element={<SwapPage />} />
              <Route path="/account/settings" element={<AccountSettingsMenu />} />
              <Route path="/account/settings/personal" element={<PersonalInfoPage />} />
              <Route path="/account/settings/notifications" element={<NotificationsPage />} />
              <Route path="/account/settings/private-key" element={<PrivateKeyPage />} />
              <Route path="/account/settings/language" element={<LanguagePage />} />
              <Route path="/account/settings/support" element={<SupportPage />} />
              <Route path="/account/settings/legal" element={<LegalPage />} />
              <Route path="/coin/:symbol" element={<CoinDetailPage />} />
              <Route path="/trade/:symbol" element={<TradePage />} />
            </Routes>
          </Suspense>
        </Layout>
      </TelegramAuthGate>
    </BrowserRouter>
  );
}

function App() {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div style={{ color: 'red', padding: 40, fontSize: 24 }}>
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
          loginMethods: ['email', 'sms', 'telegram'],
          appearance: {
            theme: 'light',
            accentColor: '#3b82f6',
          },
          embeddedWallets: {
            createOnLogin: 'users-without-wallets',
          },
          externalWallets: {
            coinbaseWallet: {
              connectionOptions: 'smartWalletOnly',
            },
          },
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
