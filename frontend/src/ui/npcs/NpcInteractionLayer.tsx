import { useCallback, useEffect, useState } from 'react';
import type { NpcDialogueSnapshot, NpcStatePayload } from '../../contracts/socket';
import { NPC_CONTEXT_EVENT } from '../../game/engine/NpcView';
import { canInteractWithNpc } from '../../game/npc/npcInteraction';
import { getQuestLog } from '../../game/quests/questClient';
import { replaceQuestMarkerStates, resetQuestMarkerStates } from '../../game/quests/questMarkerState';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { ActorContextMenu } from '../interactions/ActorContextMenu';
import { MerchantModal } from '../modals/MerchantModal';
import { NpcDialogueModal } from './NpcDialogueModal';

interface NpcContextState {
  npc: NpcStatePayload;
  x: number;
  y: number;
}

interface ActiveMerchant {
  id: string;
  name: string;
}

export function NpcInteractionLayer(): React.JSX.Element | null {
  const connection = useGameConnection();
  const state = useGameState();
  const { locale } = useI18n();
  const [context, setContext] = useState<NpcContextState>();
  const [dialogue, setDialogue] = useState<NpcDialogueSnapshot>();
  const [merchant, setMerchant] = useState<ActiveMerchant>();
  const [busy, setBusy] = useState(false);

  const refreshQuestMarkers = useCallback(async () => {
    try {
      const snapshot = await getQuestLog(connection);
      replaceQuestMarkerStates(snapshot.quests);
    } catch {
      resetQuestMarkerStates();
    }
  }, [connection]);

  useEffect(() => {
    if (state.phase === 'in-world' && state.socketConnected) void refreshQuestMarkers();
    else resetQuestMarkerStates();
  }, [refreshQuestMarkers, state.phase, state.socketConnected, state.self?.characterId]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<NpcContextState>).detail;
      if (detail && !gameStore.getSnapshot().activeModal) setContext(detail);
    };
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-actor-context-menu]')) {
        setContext(undefined);
      }
    };
    window.addEventListener(NPC_CONTEXT_EVENT, open);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener(NPC_CONTEXT_EVENT, open);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, []);

  useEffect(() => {
    if (dialogue && state.activeModal !== 'npc-dialogue') {
      const npcId = dialogue.npc.id;
      setDialogue(undefined);
      void connection.endNpcDialogue(npcId);
    }
    if (merchant && state.activeModal !== 'merchant') setMerchant(undefined);
  }, [connection, dialogue, merchant, state.activeModal]);

  const closeDialogue = () => {
    const npcId = dialogue?.npc.id;
    setDialogue(undefined);
    gameStore.setActiveModal(null);
    if (npcId) void connection.endNpcDialogue(npcId);
  };
  const closeMerchant = useCallback(() => {
    setMerchant(undefined);
    gameStore.setActiveModal(null);
  }, []);

  const startDialogue = async () => {
    if (!context || !state.self || busy) return;
    if (!canInteractWithNpc(state.self, context.npc)) {
      gameStore.addNotification({
        code: 'NPC_TOO_FAR',
        message:
          locale === 'pl'
            ? 'Podejdź bliżej do NPC, aby porozmawiać.'
            : 'Move closer to the NPC to talk.',
      });
      setContext(undefined);
      return;
    }
    setBusy(true);
    try {
      const next = await connection.startNpcDialogue(context.npc.id);
      if (gameStore.getSnapshot().activeModal) {
        setContext(undefined);
        void connection.endNpcDialogue(context.npc.id);
        return;
      }
      setDialogue(next);
      setContext(undefined);
      gameStore.setActiveModal('npc-dialogue');
    } catch {
      setContext(undefined);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (choiceId: string) => {
    if (!dialogue || busy) return;
    setBusy(true);
    try {
      const result = await connection.chooseNpcDialogue(
        dialogue.npc.id,
        dialogue.node.id,
        choiceId,
      );
      await refreshQuestMarkers();
      if (gameStore.getSnapshot().activeModal !== 'npc-dialogue') return;
      if (result.type === 'NODE') {
        setDialogue(result.dialogue);
      } else if (result.action.type === 'OPEN_MERCHANT') {
        setMerchant({ id: result.action.npcId, name: dialogue.npc.name });
        setDialogue(undefined);
        gameStore.setActiveModal('merchant');
      } else {
        setDialogue(undefined);
        gameStore.setActiveModal(null);
      }
    } catch {
      closeDialogue();
    } finally {
      setBusy(false);
    }
  };

  if (dialogue && state.activeModal === 'npc-dialogue') {
    return (
      <NpcDialogueModal
        dialogue={dialogue}
        busy={busy}
        onChoose={(choiceId) => void choose(choiceId)}
        onClose={closeDialogue}
      />
    );
  }
  if (merchant && state.activeModal === 'merchant') {
    return (
      <MerchantModal npcId={merchant.id} npcName={merchant.name} onClose={closeMerchant} />
    );
  }
  if (!context) return null;
  return (
    <ActorContextMenu
      title={context.npc.name}
      subtitle="NPC"
      x={context.x}
      y={context.y}
      actions={[
        {
          key: 'talk',
          label: locale === 'pl' ? 'Rozmawiaj' : 'Talk',
          icon: '…',
          disabled: busy,
          run: startDialogue,
        },
      ]}
    />
  );
}
