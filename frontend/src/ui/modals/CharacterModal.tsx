import type { SelfCharacterState } from '../../contracts/game';
import { CLASS_PRESENTATION } from '../../mock/outfitCatalog';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import { Modal } from './Modal';

export function CharacterModal({ character, onClose }: { character: SelfCharacterState; onClose: () => void }): React.JSX.Element {
  const presentation = CLASS_PRESENTATION[character.characterClass];
  const attributes = [
    ['Strength', character.strength],
    ['Agility', character.agility],
    ['Intelligence', character.intelligence],
    ['Armor', character.armor],
  ] as const;
  return (
    <Modal title="Character Sheet" subtitle="Read-only Phase 1 statistics" icon="◆" onClose={onClose}>
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div className="character-pedestal min-h-56">
          <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} />
        </div>
        <div>
          <h3 className="font-display text-3xl text-slate-50">{character.name}</h3>
          <p className={`mt-1 text-sm uppercase tracking-[0.18em] ${presentation.accent}`}>
            Level {character.level} {presentation.label}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">{presentation.description}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {attributes.map(([label, value]) => (
              <div key={label} className="stat-tile">
                <span>{label}</span><strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mock-banner mt-5">Leveling and derived-stat calculations are intentionally not implemented in Phase 1.</p>
    </Modal>
  );
}
