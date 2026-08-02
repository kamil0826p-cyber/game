import type { TranslationKey } from '../../i18n/dictionaries';
import { useI18n } from '../../i18n/I18nProvider';
import { TOGGLE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import { CLOSE_SOCIAL_WINDOW_EVENT, TOGGLE_SOCIAL_WINDOW_EVENT } from '../../game/social/socialUiEvents';
import { gameStore, type ModalKey } from '../../game/state/gameStore';
import {
  CLOSE_SETTINGS_WINDOW_EVENT,
  TOGGLE_SETTINGS_WINDOW_EVENT,
} from '../settings/settingsUiEvents';

const buttons: Array<{
  key: Exclude<ModalKey, null> | 'guild' | 'social' | 'settings';
  icon: string;
  labelKey?: TranslationKey;
  hotkey: string;
}> = [
  { key: 'character', icon: '◆', labelKey: 'hud.character', hotkey: 'C' },
  { key: 'inventory', icon: '▦', labelKey: 'hud.inventory', hotkey: 'I' },
  { key: 'quests', icon: '▱', labelKey: 'hud.quests', hotkey: 'Q' },
  { key: 'skills', icon: '✦', labelKey: 'hud.skills', hotkey: 'K' },
  { key: 'guild', icon: '♜', hotkey: 'G' },
  { key: 'social', icon: '✥', hotkey: 'H' },
  { key: 'settings', icon: '⚙', hotkey: 'O' },
];

export function HudButtons(): React.JSX.Element {
  const { t, locale } = useI18n();

  return (
    <nav className="hud-panel hud-tooltip-container pointer-events-auto flex flex-col gap-1.5 p-2" aria-label="HUD windows">
      {buttons.map((button) => {
        const label =
          button.key === 'guild'
            ? locale === 'pl' ? 'Gildia' : 'Guild'
            : button.key === 'social'
              ? locale === 'pl' ? 'Społeczność' : 'Social'
              : button.key === 'settings'
                ? locale === 'pl' ? 'Ustawienia' : 'Settings'
                : t(button.labelKey!);
        return (
          <button
            key={button.key}
            type="button"
            className="hud-window-button hud-tooltip-anchor"
            onClick={() => {
              if (button.key === 'settings') {
                window.dispatchEvent(new Event(CLOSE_SOCIAL_WINDOW_EVENT));
                window.dispatchEvent(new Event(TOGGLE_SETTINGS_WINDOW_EVENT));
              } else if (button.key === 'guild') {
                window.dispatchEvent(new Event(CLOSE_SOCIAL_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
                window.dispatchEvent(new Event(TOGGLE_GUILD_WINDOW_EVENT));
              } else if (button.key === 'social') {
                window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
                window.dispatchEvent(new Event(TOGGLE_SOCIAL_WINDOW_EVENT));
              } else {
                window.dispatchEvent(new Event(CLOSE_SOCIAL_WINDOW_EVENT));
                window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
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
