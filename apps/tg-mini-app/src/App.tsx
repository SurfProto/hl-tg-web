import React, { useState, useEffect } from 'react';
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
  const [authError, setAuthError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);

  useEffect(() => {
    if (!ready || authenticated) return;
    if (!isTMA) return; // Non-TMA: skip auto-login, user clicks Connect manually

    const tg = window.Telegram!.WebApp!;
    tg.ready();   // Dismiss Telegram loading indicator
    tg.expand();  // Expand to full height

    setAuthError(false);
    login({ loginMethods: ['telegram'] });

    // Timeout: if not authenticated after 15s, show error
    const timeout = setTimeout(() => {
      setAuthError(true);
    }, 15_000);

    return () => clearTimeout(timeout);
  }, [ready, authenticated, login, retryCount, isTMA]);

  // Clear error when auth succeeds
  useEffect(() => {
    if (authenticated) setAuthError(false);
  }, [authenticated]);

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

  if (authError && !authenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center p-6">
          <p className="text-gray-300 mb-2">Connection is taking longer than expected</p>
          <p className="text-gray-500 text-sm mb-6">Please check your connection and try again</p>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            className="px-6 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {!isTMA && !authenticated && (
        <div className="bg-indigo-900/30 text-center py-2 text-sm text-indigo-300">
          Open in Telegram for the best experience
        </div>
      )}
      {children}
    </>
  );
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
          loginMethods: ['email', 'sms', 'telegram'],
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
