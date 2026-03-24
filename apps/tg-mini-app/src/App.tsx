import React, { useState, useEffect } from 'react';
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

  // Handle Telegram back button
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.BackButton.onClick(() => {
        if (activeTab !== 'trade') {
          setActiveTab('trade');
        } else {
          tg.close();
        }
      });

      // Show back button when not on trade page
      if (activeTab !== 'trade') {
        tg.BackButton.show();
      } else {
        tg.BackButton.hide();
      }
    }
  }, [activeTab]);

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'trade' && <TradePage />}
      {activeTab === 'positions' && <PositionsPage />}
      {activeTab === 'portfolio' && <PortfolioPage />}
    </Layout>
  );
}

function App() {
  return (
    <React.StrictMode>
      <PrivyProvider
        appId={import.meta.env.VITE_PRIVY_APP_ID || 'YOUR_PRIVY_APP_ID'}
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
