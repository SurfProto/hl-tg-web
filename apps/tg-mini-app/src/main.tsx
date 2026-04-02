import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureBuilder } from '@repo/hyperliquid-sdk';
import App from './App';
import './index.css';

function migrateLegacyHashRoute() {
  const hash = window.location.hash;

  if (!hash.startsWith('#/')) {
    return;
  }

  const route = hash.slice(1);
  const nextUrl = route.includes('?') ? route : `${route}${window.location.search}`;
  window.history.replaceState(null, '', nextUrl);
}

function syncTelegramViewportHeight() {
  const stableHeight = window.Telegram?.WebApp?.viewportStableHeight;
  const nextHeight = typeof stableHeight === 'number' && stableHeight > 0
    ? `${stableHeight}px`
    : '100dvh';

  document.documentElement.style.setProperty('--tg-viewport-height', nextHeight);
}

function bootstrapTelegramWebApp() {
  const webApp = window.Telegram?.WebApp;

  if (!webApp) {
    syncTelegramViewportHeight();
    return;
  }

  try {
    webApp.ready();
    webApp.expand();
  } catch (error) {
    console.warn('[telegram] bootstrap failed', error);
  }

  syncTelegramViewportHeight();

  const handleViewportChanged = () => syncTelegramViewportHeight();
  webApp.onEvent?.('viewportChanged', handleViewportChanged);
}

function teardownStartupShell() {
  const startupShell = document.getElementById('startup-shell');

  if (!startupShell) {
    return;
  }

  window.requestAnimationFrame(() => {
    startupShell.setAttribute('data-hidden', 'true');
    window.setTimeout(() => startupShell.remove(), 180);
  });
}

// Inject builder config from Vite env before any rendering.
// This keeps import.meta.env usage in the app layer (where Vite runs),
// not in the shared hyperliquid-sdk package.
configureBuilder(
  import.meta.env.VITE_BUILDER_ADDRESS,
  parseInt(import.meta.env.VITE_BUILDER_FEE || '50', 10),
);

migrateLegacyHashRoute();
bootstrapTelegramWebApp();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

teardownStartupShell();
