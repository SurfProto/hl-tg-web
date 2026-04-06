import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

const LANGUAGE_KEY = 'hl-tma-language';

void i18n.use(initReactI18next).init({
  lng: localStorage.getItem(LANGUAGE_KEY) ?? 'en',
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
