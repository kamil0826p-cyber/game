import { gameStore, type ModalKey } from '../../game/state/gameStore';

const buttons: Array<{ key: Exclude<ModalKey, null>; icon: string; label: string; hotkey: string }> = [
  { key: 'character', icon: '◆', label: 'Character', hotkey: 'C' },
  { key: 'inventory', icon: '▦', label: 'Inventory', hotkey: 'I' },
  { key: 'quests', icon: '▱', label: 'Quests', hotkey: 'Q' },
  { key: 'skills', icon: '✦', label: 'Skills', hotkey: 'K' },
];

export function HudButtons(): React.JSX.Element {
  return (
    <nav className="hud-panel pointer-events-auto flex flex-col gap-1.5 p-2" aria-label="HUD windows">
      {buttons.map((button) => (
        <button key={button.key} type="button" className="hud-window-button" onClick={() => gameStore.setActiveModal(button.key)} title={`${button.label} (${button.hotkey})`}>
          <span>{button.icon}</span><kbd>{button.hotkey}</kbd>
        </button>
      ))}
    </nav>
  );
}
