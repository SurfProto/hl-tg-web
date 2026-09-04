import { useTranslation } from 'react-i18next';
import { openExternal } from '../../lib/openExternal';

export function LegalPage() {
  const { t } = useTranslation();
  const items = [
    { label: t('legal.terms'), url: import.meta.env.VITE_LEGAL_TERMS_URL },
    { label: t('legal.privacy'), url: import.meta.env.VITE_LEGAL_PRIVACY_URL },
  ].filter((item) => Boolean(item.url));

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <div>
        <p className="editorial-kicker">{t('nav.account')}</p>
        <h1 className="editorial-heading text-foreground">{t('legal.title')}</h1>
      </div>
      <div className="overflow-hidden rounded-[18px] border border-separator bg-white">
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
