import type { TranslationKey } from '../../i18n/dictionaries';
import { useI18n } from '../../i18n/I18nProvider';
import { TOGGLE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import { gameStore, type ModalKey } from '../../game/state/gameStore';

const buttons: Array<{
  key: Exclude<ModalKey, null> | 'guild';
  icon: string;
  labelKey?: TranslationKey;
  hotkey: string;
}> = [
  { key: 'character', icon: '◆', labelKey: 'hud.character', hotkey: 'C' },
  { key: 'inventory', icon: '▦', labelKey: 'hud.inventory', hotkey: 'I' },
  { key: 'quests', icon: '▱', labelKey: 'hud.quests', hotkey: 'Q' },
  { key: 'skills', icon: '✦', labelKey: 'hud.skills', hotkey: 'K' },
  { key: 'guild', icon: '♜', hotkey: 'G' },
];

export function HudButtons(): React.JSX.Element {
  const { t, locale } = useI18n();

  return (
    <nav className="hud-panel hud-tooltip-container pointer-events-auto flex flex-col gap-1.5 p-2" aria-label="HUD windows">
      {buttons.map((button) => {
        const label = button.key === 'guild'
          ? locale === 'pl' ? 'Gildia' : 'Guild'
          : t(button.labelKey!);
        return (
          <button
            key={button.key}
            type="button"
            className="hud-window-button hud-tooltip-anchor"
            onClick={() => {
              if (button.key === 'guild') {
                window.dispatchEvent(new Event(TOGGLE_GUILD_WINDOW_EVENT));
              } else {
                gameStore.setActiveModal(button.key);
              }
            }}
            aria-label={`${label} (${button.hotkey})`}
          >
            <span>{button.icon}</span><kbd>{button.hotkey}</kbd>
            <span className="hud-tooltip-bubble hud-tooltip-bubble-left" role="tooltip">
              <span>{label}</span><kbd>{button.hotkey}</kbd>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
