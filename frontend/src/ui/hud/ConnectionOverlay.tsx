import { useI18n } from '../../i18n/I18nProvider';

export function ConnectionOverlay({ reconnecting }: { reconnecting: boolean }): React.JSX.Element | null {
  const { t } = useI18n();
  if (!reconnecting) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 grid place-items-center bg-slate-950/55 backdrop-blur-sm">
      <div className="fantasy-panel p-7 text-center">
        <span className="loading-rune mx-auto mb-4 block size-10" />
        <h2 className="font-display text-2xl text-amber-100">{t('game.reconnecting')}</h2>
        <p className="mt-2 text-sm text-slate-400">Your last accepted position remains authoritative on the server.</p>
      </div>
    </div>
  );
}
