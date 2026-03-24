import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
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

function AppContent() {
  const [activeTab, setActiveTab] = useState<'trade' | 'positions' | 'portfolio'>('trade');

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'trade' && <TradePage />}
      {activeTab === 'positions' && <PositionsPage />}
      {activeTab === 'portfolio' && <PortfolioPage />}
    </Layout>
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
          loginMethods: ['email', 'sms', 'google', 'telegram'],
          embeddedWallets: {
            createOnLogin: 'users-without-wallets',
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
