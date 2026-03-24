import React, { useEffect, useState } from 'react';
import { useMiniApp, useViewport, useThemeParams, useHapticFeedback } from '@telegram-apps/sdk-react';
import { usePrivy } from '@privy-io/react-auth';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: 'trade' | 'positions' | 'portfolio';
  onTabChange: (tab: 'trade' | 'positions' | 'portfolio') => void;
}

export function Layout({ children, activeTab, onTabChange }: LayoutProps) {
  const miniApp = useMiniApp();
  const viewport = useViewport();
  const themeParams = useThemeParams();
  const haptic = useHapticFeedback();
  const { login, authenticated, user, logout } = usePrivy();

  useEffect(() => {
    // Expand the Mini App to full height
    miniApp?.expand();
    viewport?.expand();
  }, [miniApp, viewport]);

  useEffect(() => {
    // Apply Telegram theme
    if (themeParams.bg_color) {
      document.documentElement.style.setProperty('--tg-bg-color', themeParams.bg_color);
    }
    if (themeParams.text_color) {
      document.documentElement.style.setProperty('--tg-text-color', themeParams.text_color);
    }
    if (themeParams.hint_color) {
      document.documentElement.style.setProperty('--tg-hint-color', themeParams.hint_color);
    }
    if (themeParams.link_color) {
      document.documentElement.style.setProperty('--tg-link-color', themeParams.link_color);
    }
    if (themeParams.button_color) {
      document.documentElement.style.setProperty('--tg-button-color', themeParams.button_color);
    }
    if (themeParams.button_text_color) {
      document.documentElement.style.setProperty('--tg-button-text-color', themeParams.button_text_color);
    }
  }, [themeParams]);

  const handleTabChange = (tab: 'trade' | 'positions' | 'portfolio') => {
    haptic.impactOccurred('light');
    onTabChange(tab);
  };

  return (
    <div className="min-h-screen bg-[var(--tg-bg-color,#000)] text-[var(--tg-text-color,#fff)] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--tg-bg-color,#000)] border-b border-gray-800 px-4 py-3 safe-area-top">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Hyperliquid</h1>
          <div className="flex items-center space-x-3">
            {authenticated && (
              <span className="text-xs text-gray-500">
                {user?.wallet?.address?.slice(0, 4)}...{user?.wallet?.address?.slice(-4)}
              </span>
            )}
            {authenticated ? (
              <button
                onClick={logout}
                className="px-3 py-1.5 text-sm bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Logout
              </button>
            ) : (
              <button
                onClick={login}
                className="px-3 py-1.5 text-sm bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[var(--tg-bg-color,#000)] border-t border-gray-800 px-4 py-2 safe-area-bottom z-50">
        <div className="flex justify-around max-w-lg mx-auto">
          <button
            onClick={() => handleTabChange('trade')}
            className={`flex flex-col items-center p-2 rounded-lg transition-colors ${
              activeTab === 'trade'
                ? 'text-indigo-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span className="text-xs mt-1 font-medium">Trade</span>
          </button>
          <button
            onClick={() => handleTabChange('positions')}
            className={`flex flex-col items-center p-2 rounded-lg transition-colors ${
              activeTab === 'positions'
                ? 'text-indigo-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-xs mt-1 font-medium">Positions</span>
          </button>
          <button
            onClick={() => handleTabChange('portfolio')}
            className={`flex flex-col items-center p-2 rounded-lg transition-colors ${
              activeTab === 'portfolio'
                ? 'text-indigo-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs mt-1 font-medium">Portfolio</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
