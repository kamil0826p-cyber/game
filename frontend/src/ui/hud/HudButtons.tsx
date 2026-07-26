import type { TranslationKey } from '../../i18n/dictionaries';
import { useI18n } from '../../i18n/I18nProvider';
import { gameStore, type ModalKey } from '../../game/state/gameStore';

const buttons: Array<{
  key: Exclude<ModalKey, null>;
  icon: string;
  labelKey: TranslationKey;
  hotkey: string;
}> = [
  { key: 'character', icon: '◆', labelKey: 'hud.character', hotkey: 'C' },
  { key: 'inventory', icon: '▦', labelKey: 'hud.inventory', hotkey: 'I' },
  { key: 'quests', icon: '▱', labelKey: 'hud.quests', hotkey: 'Q' },
  { key: 'skills', icon: '✦', labelKey: 'hud.skills', hotkey: 'K' },
];

export function HudButtons(): React.JSX.Element {
  const { t } = useI18n();

  return (
    <nav className="hud-panel hud-tooltip-container pointer-events-auto flex flex-col gap-1.5 p-2" aria-label="HUD windows">
      {buttons.map((button) => {
        const label = t(button.labelKey);
        return (
          <button
            key={button.key}
            type="button"
            className="hud-window-button hud-tooltip hud-tooltip-left"
            onClick={() => gameStore.setActiveModal(button.key)}
            aria-label={`${label} (${button.hotkey})`}
            data-tooltip={label}
            data-tooltip-hotkey={button.hotkey}
          >
            <span>{button.icon}</span><kbd>{button.hotkey}</kbd>
          </button>
        );
      })}
    </nav>
  );
}
