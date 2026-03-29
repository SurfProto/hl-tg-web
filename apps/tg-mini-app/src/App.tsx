import React, { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { arbitrum } from 'viem/chains';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { PositionsPage } from './pages/PositionsPage';
import { PointsPage } from './pages/PointsPage';
import { AccountPage } from './pages/AccountPage';
import { CoinDetailPage } from './pages/CoinDetailPage';
import { TradePage } from './pages/TradePage';
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
  const privy = usePrivy() as any;
  const { ready, authenticated } = privy;

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
    privy.loginWithTelegram();
  }, [ready, authenticated, isTMA]);

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
