import { useEffect, useRef, useState } from 'react';
import { useToken } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import i18n, { LANGUAGE_KEY, getInitialLanguage, type SupportedLanguage } from '../../lib/i18n';
import { log } from '../../lib/logger';
import { updateProfile } from '../../lib/profile';

const LANGUAGES: { key: SupportedLanguage; labelKey: string }[] = [
  { key: 'en', labelKey: 'language.english' },
  { key: 'ru', labelKey: 'language.russian' },
];

export function LanguagePage() {
  const { getAccessToken } = useToken();
  const { t } = useTranslation();
  const [language, setLanguage] = useState<SupportedLanguage>(getInitialLanguage);
  const syncedLanguageRef = useRef<SupportedLanguage>(language);

  useEffect(() => {
    // Only on an actual change: mounting the page used to rewrite storage,
    // re-set the language, and PATCH the profile with what it already had.
    if (syncedLanguageRef.current === language) return;
    syncedLanguageRef.current = language;

    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Storage may be blocked in this WebView; the in-session language
      // still changes, only the preference is lost across reloads.
    }
    void i18n.changeLanguage(language);

    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return;
        await updateProfile(accessToken, { language });
      } catch (error) {
        // Telegram notifications are rendered in the server-side language, so
        // a failed sync means alerts keep arriving in the old one. It used to
        // fail as an unhandled rejection, invisibly.
        log.warn('[language] profile language sync failed', { error, language });
      }
    })();
  }, [getAccessToken, language]);

  return (
    <div className="editorial-page px-4 py-5 space-y-4">
      <div>
        <p className="editorial-kicker">{t('nav.account')}</p>
        <h1 className="editorial-heading text-foreground">{t('language.title')}</h1>
      </div>
      <div className="space-y-3">
        {LANGUAGES.map((option) => (
          <button
            key={option.key}
            onClick={() => setLanguage(option.key)}
            className={`flex w-full items-center justify-between rounded-[18px] border px-4 py-4 text-left transition-colors ${
              language === option.key
                ? 'border-primary bg-[var(--color-primary-soft)]'
                : 'border-separator bg-white'
            }`}
          >
            <span className="text-sm font-semibold text-foreground">{t(option.labelKey)}</span>
            <span
              className={`h-4 w-4 rounded-full border ${
                language === option.key ? 'border-primary bg-primary' : 'border-border bg-white'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
