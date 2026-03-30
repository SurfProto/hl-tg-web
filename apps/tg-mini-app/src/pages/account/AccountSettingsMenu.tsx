import { useNavigate } from 'react-router-dom';

const SETTINGS_ROUTES = [
  { path: '/account/settings/personal', label: 'Personal Information' },
  { path: '/account/settings/notifications', label: 'Notifications' },
  { path: '/account/settings/private-key', label: 'Private Key' },
  { path: '/account/settings/language', label: 'Language' },
  { path: '/account/settings/support', label: 'Support' },
  { path: '/account/settings/legal', label: 'Legal' },
];

export function AccountSettingsMenu() {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-background px-4 py-5">
      <h1 className="mb-4 text-2xl font-bold text-foreground">Account settings</h1>
      <div className="overflow-hidden rounded-2xl border border-separator bg-white shadow-sm">
        {SETTINGS_ROUTES.map((route, index) => (
          <button
            key={route.path}
            onClick={() => navigate(route.path)}
            className={`flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-foreground active:bg-surface transition-colors ${index < SETTINGS_ROUTES.length - 1 ? 'border-b border-separator' : ''}`}
          >
            <span>{route.label}</span>
            <span className="text-muted">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
