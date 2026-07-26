import { useI18n } from '../../i18n/I18nProvider';

export function LocaleToggle(): React.JSX.Element {
  const { locale, toggleLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="locale-toggle"
      title="Toggle English wording style"
    >
      <span className="locale-toggle-dot" />
      {locale === 'en' ? 'English' : 'Simple'}
    </button>
  );
}
