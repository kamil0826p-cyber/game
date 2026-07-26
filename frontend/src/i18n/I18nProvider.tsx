import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { runtimeConfig } from '../config/runtime';
import { dictionaries, type Locale, type TranslationKey } from './dictionaries';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);
const STORAGE_KEY = 'elderglen.locale';

const resolveInitialLocale = (): Locale => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'en-simple') {
    return stored;
  }
  return runtimeConfig.defaultLocale === 'en-simple' ? 'en-simple' : 'en';
};

export function I18nProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'en' ? 'en-simple' : 'en');
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
