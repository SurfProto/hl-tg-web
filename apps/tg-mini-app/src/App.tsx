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

  useEffect(() => {
    if (!ready || authenticated) return;

    // Detect if running inside a Telegram Mini App
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initData) {
      login();
    }
  }, [ready, authenticated, login]);

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

  // Debug: Check in browser console
  console.log('=== PRIVY DEBUG ===');
  console.log('App ID:', appId);
  console.log('App ID type:', typeof appId);
  console.log('App ID length:', appId?.length);

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
