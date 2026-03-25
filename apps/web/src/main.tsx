import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

const appId = import.meta.env.VITE_PRIVY_APP_ID;

if (!appId) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <div style={{ color: 'red', padding: 40, fontSize: 24 }}>
      VITE_PRIVY_APP_ID is undefined! Check environment variables.
    </div>
  );
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
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
        }}
      >
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </PrivyProvider>
    </React.StrictMode>
  );
}
