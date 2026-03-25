import React, { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { Layout } from './components/Layout';
import { TradePage } from './pages/TradePage';
import { PositionsPage } from './pages/PositionsPage';
import { PortfolioPage } from './pages/PortfolioPage';
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
  const { ready, authenticated, login } = usePrivy();
  const autoLoginAttempted = useRef(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);

  // TMA lifecycle: dismiss loading indicator + expand to full height (once)
  useEffect(() => {
    if (!isTMA) return;
    const tg = window.Telegram!.WebApp!;
    tg.ready();
    tg.expand();
  }, [isTMA]);

  // Auto-login in TMA context (seamless path) — fires only once per retry
  useEffect(() => {
    if (!ready || authenticated || !isTMA || autoLoginAttempted.current) return;
    autoLoginAttempted.current = true;
    setAuthError(null);
    (async () => {
      try {
        await (login as () => Promise<void>)();
      } catch (err: unknown) {
        setAuthError(err instanceof Error ? err.message : 'Login failed');
      }
    })();
  }, [ready, authenticated, isTMA, login, retryCount]);

  if (authError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-red-400">Authentication failed</p>
          <p className="text-gray-500 text-sm">{authError}</p>
          <button
            onClick={() => {
              autoLoginAttempted.current = false;
              setRetryCount(c => c + 1);
            }}
            className="px-6 py-2 bg-indigo-600 rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'trade' | 'positions' | 'portfolio'>('trade');

  return (
    <TelegramAuthGate>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'trade' && <TradePage />}
        {activeTab === 'positions' && <PositionsPage />}
        {activeTab === 'portfolio' && <PortfolioPage />}
      </Layout>
    </TelegramAuthGate>
  );
}

function App() {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div style={{ color: 'red', padding: 40, fontSize: 24 }}>
        ❌ VITE_PRIVY_APP_ID is undefined! Check Vercel env vars.
      </div>
    );
  }

  return (
    <React.StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          appearance: {
            theme: 'dark',
            accentColor: '#6366f1',
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
