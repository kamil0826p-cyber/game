import type { NpcDialogueSnapshot } from '../../contracts/socket';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';

interface NpcDialogueModalProps {
  dialogue: NpcDialogueSnapshot;
  busy: boolean;
  onChoose: (choiceId: string) => void;
  onClose: () => void;
}

export function NpcDialogueModal({
  dialogue,
  busy,
  onChoose,
  onClose,
}: NpcDialogueModalProps): React.JSX.Element {
  const { locale } = useI18n();
  return (
    <Modal
      title={dialogue.npc.name}
      subtitle={locale === 'pl' ? 'Rozmowa' : 'Conversation'}
      icon="…"
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <p className="text-lg leading-8 text-slate-100">{dialogue.node.text}</p>
      <div className="mt-6 grid gap-2">
        {dialogue.node.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={busy}
            className="rounded border border-amber-300/20 bg-amber-400/5 px-4 py-3 text-left text-sm text-amber-50 transition hover:border-amber-300/40 hover:bg-amber-400/10 disabled:opacity-50"
            onClick={() => onChoose(choice.id)}
          >
            {choice.label}
          </button>
        ))}
        {dialogue.node.choices.length === 0 ? (
          <button
            type="button"
            disabled={busy}
            className="hud-utility-button justify-self-start"
            onClick={onClose}
          >
            {locale === 'pl' ? 'Zakończ rozmowę' : 'End conversation'}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
