import React, { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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

function MarketsIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2 : 1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function PositionsIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.5}>
      {active ? (
        <path fillRule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 013.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 013.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 01-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875zM9.75 17.25a.75.75 0 00-1.5 0V18a.75.75 0 001.5 0v-.75zm2.25-3a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3a.75.75 0 01.75-.75zm3.75-1.5a.75.75 0 00-1.5 0V18a.75.75 0 001.5 0v-5.25z" clipRule="evenodd" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      )}
    </svg>
  );
}

function PointsIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.5}>
      {active ? (
        <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      )}
    </svg>
  );
}

function AccountIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 0 : 1.5}>
      {active ? (
        <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      )}
    </svg>
  );
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const haptics = useHaptics();
  const { t } = useTranslation();

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
    root.style.setProperty('--tg-link-color', '#00C076');
    root.style.setProperty('--tg-button-color', '#00C076');
    root.style.setProperty('--tg-button-text-color', '#ffffff');
    root.style.setProperty('--tg-secondary-bg-color', '#f5f5f5');
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

  const navItems = [
    { path: '/', label: t('nav.markets'), Icon: MarketsIcon, end: true },
    { path: '/positions', label: t('nav.positions'), Icon: PositionsIcon, end: false },
    { path: '/points', label: t('nav.points'), Icon: PointsIcon, end: false },
    { path: '/account', label: t('nav.account'), Icon: AccountIcon, end: false },
  ];

  return (
    <div className="tg-root-height bg-background text-foreground flex flex-col">
      <main className={`flex-1 overflow-y-auto ${hideNav ? '' : 'page-above-bottom-nav'}`}>
        {children}
      </main>

      {!hideNav && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-separator px-2 py-2 z-50 bottom-nav-safe">
          <div className="flex justify-around max-w-lg mx-auto">
            {navItems.map(({ path, label, Icon, end }) => (
              <NavLink
                key={path}
                to={path}
                end={end}
                onClick={() => handleTabChange(path)}
                className={({ isActive }) => `flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  isActive ? 'text-foreground' : 'text-muted'
                }`}
              >
                {({ isActive }) => (
                  <>
                    <Icon active={isActive} />
                    <span className="text-[11px] font-medium">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
