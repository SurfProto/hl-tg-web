import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

export const LANGUAGE_KEY = 'hl-tma-language';
export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function getInitialLanguage(): SupportedLanguage {
  // This runs at module load, before the ErrorBoundary exists. A WebView
  // with storage blocked throws on the accessor itself, and unguarded that
  // took the whole app down with a blank screen; English is the right
  // fallback for a preference that cannot be read.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANGUAGE_KEY);
  } catch {
    stored = null;
  }
  return SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)
    ? (stored as SupportedLanguage)
    : 'en';
}

void i18n.use(initReactI18next).init({
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
