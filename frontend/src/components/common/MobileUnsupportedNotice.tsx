import { useI18n } from '../../i18n/I18nProvider';

export function MobileUnsupportedNotice(): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-6 text-center text-slate-100 md:hidden">
      <section className="w-full max-w-sm rounded-2xl border border-amber-400/40 bg-slate-900 p-6 shadow-2xl shadow-black/60">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
          Elderglen Online
        </p>
        <h2 className="font-display mt-3 text-3xl text-amber-100">
          {t('game.mobileUnsupportedTitle')}
        </h2>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          {t('game.mobileUnsupportedMessage')}
        </p>
      </section>
    </div>
  );
}
