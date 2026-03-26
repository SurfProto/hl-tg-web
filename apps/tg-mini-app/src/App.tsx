import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { arbitrum } from 'viem/chains';
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
  // loginWithTelegram exists in the Privy bundle but was removed from types in v1.99 — cast to access it
  const privy = usePrivy() as any;
  const { ready, authenticated } = privy;

  const isTMA = Boolean(window.Telegram?.WebApp?.initData);

  // TMA lifecycle: dismiss loading indicator + expand to full height + sync theme (once)
  useEffect(() => {
    if (!isTMA) return;
    const tg = window.Telegram!.WebApp!;
    tg.ready();
    tg.expand();

    // Sync Telegram theme to CSS variables
    const tp = tg.themeParams;
    const root = document.documentElement;
    if (tp.bg_color) root.style.setProperty('--tg-bg-color', tp.bg_color);
    if (tp.text_color) root.style.setProperty('--tg-text-color', tp.text_color);
    if (tp.hint_color) root.style.setProperty('--tg-hint-color', tp.hint_color);
    if (tp.link_color) root.style.setProperty('--tg-link-color', tp.link_color);
    if (tp.button_color) root.style.setProperty('--tg-button-color', tp.button_color);
    if (tp.button_text_color) root.style.setProperty('--tg-button-text-color', tp.button_text_color);
    if (tp.secondary_bg_color) root.style.setProperty('--tg-secondary-bg-color', tp.secondary_bg_color);
  }, [isTMA]);

  // Seamless auto-login using TMA initData — no modal shown
  useEffect(() => {
    if (!ready || authenticated || !isTMA) return;
    privy.loginWithTelegram();
  }, [ready, authenticated, isTMA]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto"></div>
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
          defaultChain: arbitrum,
          supportedChains: [arbitrum],
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
