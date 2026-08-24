import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const SETTINGS_ROUTES = [
  { path: '/account/settings/personal', labelKey: 'accountSettings.personalInfo' },
  { path: '/account/settings/notifications', labelKey: 'accountSettings.notifications' },
  { path: '/account/settings/private-key', labelKey: 'accountSettings.privateKey' },
  { path: '/account/settings/language', labelKey: 'accountSettings.language' },
  { path: '/account/settings/support', labelKey: 'accountSettings.support' },
  { path: '/account/settings/legal', labelKey: 'accountSettings.legal' },
];

export function AccountSettingsMenu() {
  const { t } = useTranslation();

  return (
    <div className="editorial-page px-4 py-5">
      <p className="editorial-kicker">{t('nav.account')}</p>
      <h1 className="editorial-heading mb-5 text-foreground">{t('accountSettings.title')}</h1>
      <div className="overflow-hidden rounded-[18px] border border-separator bg-white">
        {SETTINGS_ROUTES.map((route, index) => (
          <Link
            key={route.path}
            to={route.path}
            className={`flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-foreground active:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${index < SETTINGS_ROUTES.length - 1 ? 'border-b border-separator' : ''}`}
          >
            <span>{t(route.labelKey)}</span>
            <span className="text-muted" aria-hidden="true">{'\u203a'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
