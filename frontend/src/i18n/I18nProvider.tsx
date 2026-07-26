import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { dictionaries, type Locale, type TranslationKey } from './dictionaries';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);
const STORAGE_KEY = 'elderglen.locale';
const supportedLocales = Object.keys(dictionaries) as Locale[];

const isLocale = (value: string | null): value is Locale =>
  value !== null && supportedLocales.includes(value as Locale);

const localeFromBrowser = (): Locale => {
  const candidates = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const language = candidate.toLowerCase().split('-')[0];
    if (isLocale(language)) {
      return language;
    }
  }
  return 'en';
};

const resolveInitialLocale = (): Locale => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) {
    return stored;
  }
  return localeFromBrowser();
};

export function I18nProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    const currentIndex = supportedLocales.indexOf(locale);
    const nextLocale = supportedLocales[(currentIndex + 1) % supportedLocales.length] ?? 'en';
    setLocale(nextLocale);
  }, [locale, setLocale]);

  const t = useCallback(
    (key: TranslationKey, variables: Record<string, string | number> = {}) => {
      const template = dictionaries[locale][key] ?? dictionaries.en[key];
      let message: string = template;
      for (const [name, value] of Object.entries(variables)) {
        message = message.replaceAll(`{${name}}`, String(value));
      }
      return message;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale, t }),
    [locale, setLocale, t, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider.');
  }
  return context;
}
