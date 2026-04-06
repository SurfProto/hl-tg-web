import { useTranslation } from 'react-i18next';

function openExternal(url?: string) {
  if (!url) return;
  if (window.Telegram?.WebApp?.openLink) {
    (window.Telegram.WebApp as any).openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function LegalPage() {
  const { t } = useTranslation();
  const items = [
    { label: t('legal.terms'), url: import.meta.env.VITE_LEGAL_TERMS_URL },
    { label: t('legal.privacy'), url: import.meta.env.VITE_LEGAL_PRIVACY_URL },
  ].filter((item) => Boolean(item.url));

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('legal.title')}</h1>
      <div className="overflow-hidden rounded-2xl border border-separator bg-white shadow-sm">
        {items.map((item, index) => (
          <button
            key={item.label}
            onClick={() => openExternal(item.url)}
            className={`flex w-full items-center justify-between px-4 py-4 text-left text-sm font-semibold text-foreground ${index < items.length - 1 ? 'border-b border-separator' : ''}`}
          >
            <span>{item.label}</span>
            <span className="text-muted">{'\u203a'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
