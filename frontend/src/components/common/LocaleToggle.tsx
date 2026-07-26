import { useI18n } from '../../i18n/I18nProvider';

export function LocaleToggle(): React.JSX.Element {
  const { locale, toggleLocale, t } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="hud-utility-button"
      title="Change language"
    >
      {locale === 'pl' ? t('language.polish') : t('language.english')}
    </button>
  );
}
