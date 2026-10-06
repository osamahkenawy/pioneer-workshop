import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ar from './locales/ar.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';
import ja from './locales/ja.json';
import pt from './locales/pt.json';
import sw from './locales/sw.json';
import tl from './locales/tl.json';
import tr from './locales/tr.json';
import ur from './locales/ur.json';
import zh from './locales/zh.json';

const RTL_LANGS = ['ar', 'ur'];
const savedLang = (() => {
  try { return localStorage.getItem('lang') || 'en'; } catch { return 'en'; }
})();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
    es: { translation: es },
    fr: { translation: fr },
    hi: { translation: hi },
    ja: { translation: ja },
    pt: { translation: pt },
    sw: { translation: sw },
    tl: { translation: tl },
    tr: { translation: tr },
    ur: { translation: ur },
    zh: { translation: zh },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Persist language + keep document direction in sync (RTL support)
i18n.on('languageChanged', (lng) => {
  try { localStorage.setItem('lang', lng); } catch { /* ignore */ }
  document.documentElement.dir = RTL_LANGS.includes(lng) ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
});
document.documentElement.dir = RTL_LANGS.includes(savedLang) ? 'rtl' : 'ltr';
document.documentElement.lang = savedLang;

export default i18n;
