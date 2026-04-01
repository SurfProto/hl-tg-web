import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider, usePrivy, type User } from '@privy-io/react-auth';
import { arbitrum } from 'viem/chains';

// loginWithTelegram was removed from Privy public types in v1.99 but remains in the bundle.
// This interface narrows the cast to only the extra method we need, avoiding `as any`.
interface PrivyWithTelegram {
  ready: boolean;
  authenticated: boolean;
  user: User | null;
  loginWithTelegram: () => Promise<void>;
}
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
  // Narrow cast: only exposes loginWithTelegram, not the full `any` escape hatch
  const privy = usePrivy() as unknown as PrivyWithTelegram;
  const { ready, authenticated, user } = privy;
  const [loginError, setLoginError] = useState<string | null>(null);

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);

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
    setLoginError(null);
    privy.loginWithTelegram().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setLoginError(message);
    });
  }, [ready, authenticated, isTMA]);

  useEffect(() => {
    if (!ready || !authenticated) return;

    const telegramProfile = getTelegramProfile();
    void ensureUser({
      telegramId: telegramProfile?.id != null ? String(telegramProfile.id) : undefined,
      username: telegramProfile?.username ?? user?.telegram?.username ?? user?.email?.address ?? undefined,
      walletAddress: user?.wallet?.address,
    });
  }, [authenticated, ready, user]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
      </div>
    );
  }

  if (loginError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-red-500 text-sm">{loginError}</p>
        <button
          className="px-6 py-2 bg-blue-500 text-white rounded-full text-sm font-medium"
          onClick={() => {
            setLoginError(null);
            privy.loginWithTelegram().catch((err: unknown) => {
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
    <HashRouter>
      <TelegramAuthGate>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/points" element={<PointsPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/deposit" element={<DepositPage />} />
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
            <Route path="/trade/:symbol" element={<TradePage />} />
          </Routes>
        </Layout>
      </TelegramAuthGate>
    </HashRouter>
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
    <React.StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          defaultChain: arbitrum,
          supportedChains: [arbitrum],
          // Restrict login methods to prevent Google OAuth popup in Telegram WebView
          loginMethods: ['email', 'sms', 'telegram'],
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
          <AppContent />
        </QueryClientProvider>
      </PrivyProvider>
    </React.StrictMode>
  );
}

export default App;
