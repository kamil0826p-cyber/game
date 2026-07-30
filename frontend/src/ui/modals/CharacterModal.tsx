import type { SelfCharacterState } from '../../contracts/game';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const classLabelKey = {
  MAGE: 'class.mage',
  WARRIOR: 'class.warrior',
  ARCHER: 'class.archer',
} as const;

const classDescriptionKey = {
  MAGE: 'class.mageDescription',
  WARRIOR: 'class.warriorDescription',
  ARCHER: 'class.archerDescription',
} as const;

export function CharacterModal({ character, onClose }: { character: SelfCharacterState; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const attributes = [
    [t('modal.character.strength'), character.strength],
    [t('modal.character.agility'), character.agility],
    [t('modal.character.intelligence'), character.intelligence],
    [t('modal.character.armor'), character.armor],
  ] as const;
  return (
    <Modal title={t('modal.character.title')} subtitle={t('modal.character.subtitle')} icon="◆" onClose={onClose}>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div className="character-pedestal min-h-56">
          <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} />
        </div>
        <div>
          <h3 className="font-display text-3xl text-slate-50">{character.name}</h3>
          <p className="mt-1 text-sm uppercase tracking-[0.18em] text-amber-200">
            {t('common.level')} {character.level} {t(classLabelKey[character.characterClass])}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">{t(classDescriptionKey[character.characterClass])}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {attributes.map(([label, value]) => (
              <div key={label} className="stat-tile">
                <span>{label}</span><strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
