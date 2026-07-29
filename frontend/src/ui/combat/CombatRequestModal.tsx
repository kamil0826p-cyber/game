import type { CombatSnapshot } from '../../contracts/socket';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';

interface CombatRequestModalProps {
  combat: CombatSnapshot;
  busy: boolean;
  onRespond: (accept: boolean) => void;
  onCancel: () => void;
}

export function CombatRequestModal({
  combat,
  busy,
  onRespond,
  onCancel,
}: CombatRequestModalProps): React.JSX.Element {
  const state = useGameState();
  const { t } = useI18n();
  const selfId = state.self?.characterId;
  const initiator = combat.participants.find(
    (participant) => participant.actorId === combat.initiatorActorId,
  )!;
  const recipient = combat.participants.find(
    (participant) => participant.actorId === combat.recipientActorId,
  )!;
  const isRecipient = recipient.characterId === selfId;

  return (
    <Modal
      title={t('combat.request.title')}
      subtitle={`${initiator.name} → ${recipient.name}`}
      icon="⚔"
      onClose={onCancel}
      widthClass="max-w-md"
    >
      <div className="combat-request-emblem" aria-hidden="true">
        ⚔
      </div>
      <p className="mt-4 text-center text-sm text-slate-300">
        {isRecipient
          ? t('combat.request.incoming', { name: initiator.name })
          : t('combat.request.waiting', { name: recipient.name })}
      </p>
      <p className="mt-2 text-center text-xs text-amber-200/70">
        {t('combat.request.outlawRule')}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {isRecipient ? (
          <>
            <button
              className="hud-utility-button px-4 py-2"
              disabled={busy}
              onClick={() => onRespond(false)}
            >
              {t('combat.request.decline')}
            </button>
            <button
              className="combat-primary-button px-5 py-2"
              disabled={busy}
              onClick={() => onRespond(true)}
            >
              {t('combat.request.accept')}
            </button>
          </>
        ) : (
          <button className="hud-utility-button px-4 py-2" disabled={busy} onClick={onCancel}>
            {t('combat.request.cancel')}
          </button>
        )}
      </div>
    </Modal>
  );
}
