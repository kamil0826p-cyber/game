import { gameSettingsStore, useGameSettings } from '../../game/settings/gameSettingsStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { locale } = useI18n();
  const { musicEnabled } = useGameSettings();
  const copy =
    locale === 'pl'
      ? {
          title: 'Ustawienia',
          subtitle: 'Dostosuj działanie klienta gry',
          music: 'Muzyka w grze',
          musicDescription: 'Odtwarzaj losowo muzykę w tle podczas gry.',
          enabled: 'Włączona',
          disabled: 'Wyłączona',
          saved: 'Ustawienie jest zapisywane w tej przeglądarce.',
        }
      : {
          title: 'Settings',
          subtitle: 'Customize the game client',
          music: 'In-game music',
          musicDescription: 'Randomly play background music while you are in the game.',
          enabled: 'Enabled',
          disabled: 'Disabled',
          saved: 'This setting is saved in this browser.',
        };

  return (
    <Modal title={copy.title} subtitle={copy.subtitle} icon="⚙" onClose={onClose} widthClass="max-w-lg">
      <div className="rounded-xl border border-amber-200/15 bg-slate-950/35 p-4 shadow-inner shadow-black/20">
        <div className="flex items-center justify-between gap-5">
          <div>
            <h3 className="font-display text-lg text-amber-100">{copy.music}</h3>
            <p className="mt-1 max-w-sm text-sm leading-5 text-slate-400">{copy.musicDescription}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              type="button"
              role="switch"
              aria-checked={musicEnabled}
              aria-label={copy.music}
              className={`relative h-7 w-12 overflow-hidden rounded-full border p-0 transition-colors ${
                musicEnabled
                  ? 'border-amber-300/70 bg-amber-500/35'
                  : 'border-slate-500/70 bg-slate-800/80'
              }`}
              onClick={() => gameSettingsStore.setMusicEnabled(!musicEnabled)}
            >
              <span
                className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-white/30 bg-slate-100 shadow transition-transform duration-200 ${
                  musicEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              {musicEnabled ? copy.enabled : copy.disabled}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{copy.saved}</p>
    </Modal>
  );
}
