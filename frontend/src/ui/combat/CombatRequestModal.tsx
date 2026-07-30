import '../../contracts/groupCombat';
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

export function CombatRequestModal({ combat, busy, onRespond, onCancel }: CombatRequestModalProps): React.JSX.Element {
  const state = useGameState();
  const { t, locale } = useI18n();
  const selfId = state.self?.characterId;
  const initiator = combat.participants.find((participant) => participant.actorId === combat.initiatorActorId)!;
  const recipient = combat.participants.find((participant) => participant.actorId === combat.recipientActorId)!;
  const initiatorTeam = combat.teams?.find((team) => team.anchorActorId === combat.initiatorActorId);
  const recipientTeam = combat.teams?.find((team) => team.anchorActorId === combat.recipientActorId);
  const isRecipient = recipient.characterId === selfId;
  const teamNames = (actorIds: readonly string[] | undefined): string =>
    (actorIds ?? []).map((actorId) => combat.participants.find((participant) => participant.actorId === actorId)?.name).filter(Boolean).join(', ');

  return (
    <Modal
      title={t('combat.request.title')}
      subtitle={`${initiator.name} (${initiatorTeam?.actorIds.length ?? 1}) → ${recipient.name} (${recipientTeam?.actorIds.length ?? 1})`}
      icon="⚔"
      onClose={onCancel}
      widthClass="max-w-lg"
    >
      <div className="combat-request-emblem" aria-hidden="true">⚔</div>
      <p className="mt-4 text-center text-sm text-slate-300">
        {isRecipient
          ? t('combat.request.incoming', { name: initiator.name })
          : t('combat.request.waiting', { name: recipient.name })}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-emerald-300/15 bg-emerald-400/5 p-2.5">
          <strong className="text-emerald-200">{locale === 'pl' ? 'Atakujący' : 'Attackers'}</strong>
          <p className="mt-1 line-clamp-3 text-slate-400">{teamNames(initiatorTeam?.actorIds) || initiator.name}</p>
        </div>
        <div className="rounded-lg border border-rose-300/15 bg-rose-400/5 p-2.5 text-right">
          <strong className="text-rose-200">{locale === 'pl' ? 'Obrońcy' : 'Defenders'}</strong>
          <p className="mt-1 line-clamp-3 text-slate-400">{teamNames(recipientTeam?.actorIds) || recipient.name}</p>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-amber-200/70">{t('combat.request.outlawRule')}</p>
      <p className="mt-1 text-center text-[10px] text-slate-500">
        {locale === 'pl' ? 'Skład zostaje zamrożony po utworzeniu wyzwania.' : 'The roster is frozen when the challenge is created.'}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {isRecipient ? (
          <>
            <button className="hud-utility-button px-4 py-2" disabled={busy} onClick={() => onRespond(false)}>{t('combat.request.decline')}</button>
            <button className="combat-primary-button px-5 py-2" disabled={busy} onClick={() => onRespond(true)}>{t('combat.request.accept')}</button>
          </>
        ) : (
          <button className="hud-utility-button px-4 py-2" disabled={busy} onClick={onCancel}>{t('combat.request.cancel')}</button>
        )}
      </div>
    </Modal>
  );
}
