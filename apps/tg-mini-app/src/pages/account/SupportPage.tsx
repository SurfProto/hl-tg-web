import { useTranslation } from 'react-i18next';

function openExternal(url?: string) {
  if (!url) return;
  if (window.Telegram?.WebApp?.openLink) {
    (window.Telegram.WebApp as any).openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function SupportPage() {
  const { t } = useTranslation();
  const items = [
    { label: t('support.faq'), url: import.meta.env.VITE_SUPPORT_FAQ_URL },
    { label: t('support.survey'), url: import.meta.env.VITE_SUPPORT_SURVEY_URL },
    { label: t('support.twitter'), url: import.meta.env.VITE_SUPPORT_TWITTER_URL },
    { label: t('support.reportBug'), url: import.meta.env.VITE_SUPPORT_BUG_URL },
  ].filter((item) => Boolean(item.url));

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('support.title')}</h1>
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
        {import.meta.env.VITE_SUPPORT_EMAIL && (
          <a href={`mailto:${import.meta.env.VITE_SUPPORT_EMAIL}`} className="flex items-center justify-between px-4 py-4 text-sm font-semibold text-foreground">
            <span>{t('support.email')}</span>
            <span className="text-muted">{import.meta.env.VITE_SUPPORT_EMAIL}</span>
          </a>
        )}
      </div>
    </div>
  );
}
