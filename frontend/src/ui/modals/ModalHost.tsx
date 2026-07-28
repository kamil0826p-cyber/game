import { useCallback, useEffect } from 'react';
import { gameStore, useGameState, type ModalKey } from '../../game/state/gameStore';
import { CharacterModal } from './CharacterModal';
import { InventoryModal } from './InventoryModal';
import { MerchantModal } from './MerchantModal';
import { PlayerInteractionModal } from './PlayerInteractionModal';
import { QuestModal } from './QuestModal';
import { SkillModal } from './SkillModal';
import { TradeModal } from './TradeModal';
import { TradeRequestModal } from './TradeRequestModal';

const modalByKey: Readonly<Record<string, ModalKey | undefined>> = {
  c: 'character', C: 'character',
  i: 'inventory', I: 'inventory',
  q: 'quests', Q: 'quests',
  k: 'skills', K: 'skills',
};

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function ModalHost(): React.JSX.Element | null {
  const state = useGameState();
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === 'Escape' && state.activeModal) {
        event.preventDefault();
        if (state.trade && ['REQUESTED', 'OPEN', 'LOCKED'].includes(state.trade.status)) return;
        gameStore.setActiveModal(null);
        return;
      }
      const modal = modalByKey[event.key];
      if (modal) {
        event.preventDefault();
        gameStore.setActiveModal(state.activeModal === modal ? null : modal);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [state.activeModal, state.trade]);

  const close = useCallback(() => gameStore.setActiveModal(null), []);
  if (!state.self || !state.activeModal) return null;
  if (state.activeModal === 'character') return <CharacterModal character={state.self} onClose={close} />;
  if (state.activeModal === 'inventory') return <InventoryModal onClose={close} />;
  if (state.activeModal === 'merchant') return <MerchantModal onClose={close} />;
  if (state.activeModal === 'quests') return <QuestModal onClose={close} />;
  if (state.activeModal === 'skills') return <SkillModal onClose={close} />;
  if (state.activeModal === 'player') {
    const player = state.selectedPlayerId ? state.players[state.selectedPlayerId] : undefined;
    return player ? <PlayerInteractionModal player={player} onClose={close} /> : null;
  }
  if (state.activeModal === 'trade-request') return state.trade ? <TradeRequestModal trade={state.trade} /> : null;
  return state.trade ? <TradeModal trade={state.trade} /> : null;
}
