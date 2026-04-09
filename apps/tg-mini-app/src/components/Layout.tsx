import React, { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useHaptics } from '../hooks/useHaptics';

interface LayoutProps {
  children: React.ReactNode;
}

const SUB_ROUTES_HIDE_NAV = [
  '/coin/',
  '/trade/',
  '/account/deposit',
  '/account/withdraw',
  '/account/transfer',
  '/account/swap',
  '/account/settings',
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const haptics = useHaptics();

  const hideNav = SUB_ROUTES_HIDE_NAV.some((prefix) => location.pathname.startsWith(prefix));
  const activeTab = location.pathname === '/'
    ? '/'
    : location.pathname.startsWith('/positions')
      ? '/positions'
      : location.pathname.startsWith('/points')
        ? '/points'
        : location.pathname.startsWith('/account')
          ? '/account'
          : '/';

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--tg-bg-color', '#ffffff');
    root.style.setProperty('--tg-text-color', '#111827');
    root.style.setProperty('--tg-hint-color', '#6b7280');
    root.style.setProperty('--tg-link-color', '#3b82f6');
    root.style.setProperty('--tg-button-color', '#3b82f6');
    root.style.setProperty('--tg-button-text-color', '#ffffff');
    root.style.setProperty('--tg-secondary-bg-color', '#f8f9fa');
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    if (hideNav) {
      tg.BackButton?.show();
      const handler = () => navigate(-1);
      tg.BackButton?.onClick(handler);
      return () => {
        tg.BackButton?.offClick(handler);
        tg.BackButton?.hide();
      };
    }

    tg.BackButton?.hide();
  }, [hideNav, navigate]);

  const handleTabChange = (path: string) => {
    if (path !== activeTab) {
      haptics.light();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className={`flex-1 overflow-y-auto ${hideNav ? '' : 'pb-20'}`}>
        {children}
      </main>

      {!hideNav && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-2 z-50 safe-area-bottom">
          <div className="flex justify-around max-w-lg mx-auto">
            <NavLink
              to="/"
              end
              onClick={() => handleTabChange('/')}
              className={({ isActive }) => `flex flex-col items-center p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                isActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
              </svg>
              <span className="text-xs mt-1 font-medium">Home</span>
            </NavLink>

            <NavLink
              to="/positions"
              onClick={() => handleTabChange('/positions')}
              className={({ isActive }) => `flex flex-col items-center p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                isActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-xs mt-1 font-medium">Positions</span>
            </NavLink>

            <NavLink
              to="/points"
              onClick={() => handleTabChange('/points')}
              className={({ isActive }) => `flex flex-col items-center p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                isActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <span className="text-xs mt-1 font-medium">Points</span>
            </NavLink>

            <NavLink
              to="/account"
              onClick={() => handleTabChange('/account')}
              className={({ isActive }) => `flex flex-col items-center p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                isActive ? 'text-primary' : 'text-muted'
              }`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs mt-1 font-medium">Account</span>
            </NavLink>
          </div>
        </nav>
      )}
    </div>
  );
}
