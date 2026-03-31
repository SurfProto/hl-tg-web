import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { HyperliquidProvider } from '@repo/hyperliquid-sdk';
import { ErrorBoundary } from './components/ErrorBoundary';
import { arbitrum } from 'viem/chains';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { PositionsPage } from './pages/PositionsPage';
import { PointsPage } from './pages/PointsPage';
import { AccountPage } from './pages/AccountPage';
import { CoinDetailPage } from './pages/CoinDetailPage';
import { TradePage } from './pages/TradePage';
import { DepositPage } from './pages/account/DepositPage';
import { WithdrawPage } from './pages/account/WithdrawPage';
import { TransferPage } from './pages/account/TransferPage';
import { SwapPage } from './pages/account/SwapPage';
import { AccountSettingsMenu } from './pages/account/AccountSettingsMenu';
import { PersonalInfoPage } from './pages/account/PersonalInfoPage';
import { NotificationsPage } from './pages/account/NotificationsPage';
import { PrivateKeyPage } from './pages/account/PrivateKeyPage';
import { LanguagePage } from './pages/account/LanguagePage';
import { SupportPage } from './pages/account/SupportPage';
import { LegalPage } from './pages/account/LegalPage';
import { ensureUser, getTelegramProfile } from './lib/supabase';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

// Seamless Telegram auth component
function TelegramAuthGate({ children }: { children: React.ReactNode }) {
  // loginWithTelegram exists in the Privy bundle but was removed from types in v1.99 — cast to access it
  const privy = usePrivy() as unknown as {
    ready: boolean;
    authenticated: boolean;
    user: ReturnType<typeof usePrivy>['user'];
    loginWithTelegram: () => Promise<void>;
  };
  const { ready, authenticated, user } = privy;

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);
  const [authError, setAuthError] = useState<string | null>(null);

  // TMA lifecycle: dismiss loading indicator + expand to full height (once)
  useEffect(() => {
    if (!isTMA) return;
    const tg = window.Telegram!.WebApp!;
    tg.ready();
    tg.expand();
  }, [isTMA]);

  // Seamless auto-login using TMA initData — no modal shown
  useEffect(() => {
    if (!ready || authenticated || !isTMA) return;
    setAuthError(null);
    privy.loginWithTelegram().catch((err: unknown) => {
      console.error('[TMA] loginWithTelegram failed:', err);
      setAuthError('Login failed. Please tap Retry or restart the app.');
    });
  }, [ready, authenticated, isTMA]);

  useEffect(() => {
    if (!ready || !authenticated) return;

    const telegramProfile = getTelegramProfile();
    void ensureUser({
      privyUserId: user?.id,
      telegramId: telegramProfile?.id != null ? String(telegramProfile.id) : undefined,
      username: telegramProfile?.username ?? user?.telegram?.username ?? user?.email?.address ?? undefined,
      walletAddress: user?.wallet?.address,
    });
  }, [authenticated, ready, user]);

  if (authError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-destructive text-sm">{authError}</p>
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
          onClick={() => {
            setAuthError(null);
            privy.loginWithTelegram().catch((err: unknown) => {
              console.error('[TMA] loginWithTelegram retry failed:', err);
              setAuthError('Login failed. Please restart the app.');
            });
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppContent() {
  return (
    <HashRouter>
      <TelegramAuthGate>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/points" element={<PointsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/deposit" element={<ErrorBoundary><DepositPage /></ErrorBoundary>} />
            <Route path="/account/withdraw" element={<WithdrawPage />} />
            <Route path="/account/transfer" element={<TransferPage />} />
            <Route path="/account/swap" element={<SwapPage />} />
            <Route path="/account/settings" element={<AccountSettingsMenu />} />
            <Route path="/account/settings/personal" element={<PersonalInfoPage />} />
            <Route path="/account/settings/notifications" element={<NotificationsPage />} />
            <Route path="/account/settings/private-key" element={<PrivateKeyPage />} />
            <Route path="/account/settings/language" element={<LanguagePage />} />
            <Route path="/account/settings/support" element={<SupportPage />} />
            <Route path="/account/settings/legal" element={<LegalPage />} />
            <Route path="/coin/:symbol" element={<CoinDetailPage />} />
            <Route path="/trade/:symbol" element={<ErrorBoundary><TradePage /></ErrorBoundary>} />
          </Routes>
        </Layout>
      </TelegramAuthGate>
    </HashRouter>
  );
}

// OAuth-based login methods that require browser popups — incompatible with Telegram WebView
const POPUP_LOGIN_METHODS = new Set([
  'google', 'apple', 'twitter', 'discord', 'github', 'linkedin', 'spotify', 'tiktok', 'instagram',
]);

function App() {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div style={{ color: 'red', padding: 40, fontSize: 24 }}>
        VITE_PRIVY_APP_ID is undefined! Check Vercel env vars.
      </div>
    );
  }

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);

  // VITE_PRIVY_LOGIN_METHODS (comma-separated) mirrors your Privy dashboard config.
  // In TMA context, popup-based OAuth methods are stripped automatically.
  // If unset in TMA, only explicitly non-popup methods are allowed.
  const rawMethods = import.meta.env.VITE_PRIVY_LOGIN_METHODS as string | undefined;
  const loginMethods = isTMA && rawMethods
    ? (rawMethods.split(',').map(m => m.trim()).filter(m => !POPUP_LOGIN_METHODS.has(m)) as any[])
    : undefined;

  return (
    <React.StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          defaultChain: arbitrum,
          supportedChains: [arbitrum],
          loginMethods,
          appearance: {
            theme: 'light',
            accentColor: '#3b82f6',
          },
          embeddedWallets: {
            createOnLogin: 'users-without-wallets',
          },
          // Disable Coinbase Wallet SDK to prevent SES Lockdown in Telegram Mini Apps
          externalWallets: {
            coinbaseWallet: {
              connectionOptions: 'smartWalletOnly',
            },
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <HyperliquidProvider>
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
          </HyperliquidProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </React.StrictMode>
  );
}

export default App;
