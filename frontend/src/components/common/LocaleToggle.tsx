import { useI18n } from '../../i18n/I18nProvider';

export function LocaleToggle(): React.JSX.Element {
  const { locale, toggleLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="rounded border border-slate-600/70 bg-slate-950/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-300 transition hover:border-amber-400/60 hover:text-amber-100"
      title="Toggle English wording style"
    >
      {locale === 'en' ? 'English' : 'Simple English'}
    </button>
  );
}
