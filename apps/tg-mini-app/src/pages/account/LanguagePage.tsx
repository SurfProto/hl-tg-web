import { useEffect, useState } from 'react';
import { useToken } from '@privy-io/react-auth';
import { useTranslation } from 'react-i18next';
import i18n, { LANGUAGE_KEY, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../lib/i18n';
import { updateProfile } from '../../lib/profile';

const LANGUAGES: { key: SupportedLanguage; labelKey: string }[] = [
  { key: 'en', labelKey: 'language.english' },
  { key: 'ru', labelKey: 'language.russian' },
];

export function LanguagePage() {
  const { getAccessToken } = useToken();
  const { t } = useTranslation();
  const [language, setLanguage] = useState<SupportedLanguage>(
    () => {
      const stored = localStorage.getItem(LANGUAGE_KEY);
      return SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)
        ? (stored as SupportedLanguage)
        : 'en';
    },
  );

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
    void i18n.changeLanguage(language);

    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) return;
      await updateProfile(accessToken, { language });
    })();
  }, [getAccessToken, language]);

  return (
    <div className="min-h-full bg-background px-4 py-5 space-y-4">
      <h1 className="text-2xl font-bold text-foreground">{t('language.title')}</h1>
      <div className="space-y-3">
        {LANGUAGES.map((option) => (
          <button
            key={option.key}
            onClick={() => setLanguage(option.key)}
            className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left shadow-sm transition-colors ${
              language === option.key
                ? 'border-primary bg-blue-50'
                : 'border-separator bg-white'
            }`}
          >
            <span className="text-sm font-semibold text-foreground">{t(option.labelKey)}</span>
            <span
              className={`h-4 w-4 rounded-full border ${
                language === option.key ? 'border-primary bg-primary' : 'border-gray-300 bg-white'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
