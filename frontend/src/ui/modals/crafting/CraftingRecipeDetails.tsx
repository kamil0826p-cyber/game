import { ItemIcon } from '../../../components/common/ItemIcon';
import { rarityClasses } from '../../../components/common/ItemTooltip';
import type { CraftingRecipePayload } from '../../../contracts/crafting';
import type { EquipmentSlot, ItemStatBonuses } from '../../../contracts/socket';

const statLabels: Record<keyof ItemStatBonuses, { en: string; pl: string }> = {
  strength: { en: 'Strength', pl: 'Siła' },
  agility: { en: 'Agility', pl: 'Zręczność' },
  intelligence: { en: 'Intelligence', pl: 'Inteligencja' },
  armor: { en: 'Armor', pl: 'Pancerz' },
  maxHp: { en: 'Maximum HP', pl: 'Maks. zdrowie' },
  maxEnergy: { en: 'Maximum energy', pl: 'Maks. energia' },
};
const slotLabels: Record<EquipmentSlot, { en: string; pl: string }> = {
  HEAD: { en: 'Head', pl: 'Głowa' }, CHEST: { en: 'Chest', pl: 'Napierśnik' },
  LEGS: { en: 'Legs', pl: 'Nogi' }, FEET: { en: 'Feet', pl: 'Buty' },
  MAIN_HAND: { en: 'Main hand', pl: 'Główna ręka' }, OFF_HAND: { en: 'Off hand', pl: 'Druga ręka' },
  AMULET: { en: 'Amulet', pl: 'Amulet' }, RING: { en: 'Ring', pl: 'Pierścień' },
};
const classLabels = {
  WARRIOR: { en: 'Warrior', pl: 'Wojownik' },
  MAGE: { en: 'Mage', pl: 'Mag' },
  ARCHER: { en: 'Archer', pl: 'Łucznik' },
} as const;

interface CraftingRecipeDetailsProps {
  recipe: CraftingRecipePayload | undefined;
  silver: number;
  locale: 'en' | 'pl';
  busy: boolean;
  onCraft: () => void;
}

export function CraftingRecipeDetails({
  recipe,
  silver,
  locale,
  busy,
  onCraft,
}: CraftingRecipeDetailsProps): React.JSX.Element {
  if (!recipe) {
    return <section className="rounded border border-amber-400/20 bg-black/20 p-8 text-center text-sm text-slate-400">{locale === 'pl' ? 'Wybierz recepturę.' : 'Select a recipe.'}</section>;
  }
  const stats = (Object.entries(recipe.output.statBonuses) as Array<[keyof ItemStatBonuses, number | undefined]>)
    .filter((entry): entry is [keyof ItemStatBonuses, number] => typeof entry[1] === 'number');
  const reasons: string[] = [];
  if (!recipe.availability.levelMet) reasons.push(locale === 'pl' ? `Wymagany poziom: ${recipe.requiredLevel}.` : `Required level: ${recipe.requiredLevel}.`);
  if (!recipe.availability.regionMet) reasons.push(locale === 'pl' ? `Wymagany region: ${recipe.regionKey ?? '—'}.` : `Required region: ${recipe.regionKey ?? '—'}.`);
  if (!recipe.availability.workstationMet) reasons.push(locale === 'pl' ? 'Nieprawidłowe stanowisko.' : 'Wrong workstation.');
  if (!recipe.availability.silverMet) reasons.push(locale === 'pl' ? `Brakuje ${Math.max(0, recipe.silverCost - silver)} srebra.` : `You need ${Math.max(0, recipe.silverCost - silver)} more silver.`);
  if (!recipe.availability.materialsMet) reasons.push(locale === 'pl' ? 'Brakuje materiałów.' : 'Required materials are missing.');

  return (
    <section className="rounded border border-amber-400/20 bg-black/20 p-4">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span className={`grid h-16 w-16 shrink-0 place-items-center rounded border bg-black/30 ${rarityClasses(recipe.output.rarity)}`}>
              <ItemIcon definitionKey={recipe.output.definitionKey} fallback={recipe.output.icon} className="h-12 w-12" />
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-2xl text-amber-100">{recipe.output.name}</h3>
              <p className="mt-1 text-sm text-slate-300">{recipe.output.description}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                <span>{recipe.output.rarity}</span>
                {recipe.output.equipmentSlot ? <span>• {slotLabels[recipe.output.equipmentSlot][locale]}</span> : null}
                {recipe.output.requiredClass ? <span>• {classLabels[recipe.output.requiredClass][locale]}</span> : null}
                <span>• {locale === 'pl' ? 'Poziom' : 'Level'} {recipe.output.minimumLevel}</span>
              </div>
            </div>
          </div>
          <div className="rounded border border-amber-400/20 bg-black/25 px-3 py-2 text-right text-xs">
            <div className="text-slate-400">{locale === 'pl' ? 'Jakość wytworzenia' : 'Craft quality'}</div>
            <strong className="text-amber-200">{recipe.craftQuality}%</strong>
            <div className="mt-1 text-slate-500">{locale === 'pl' ? 'Trudność' : 'Complexity'}: {recipe.complexity}</div>
          </div>
        </div>

        {stats.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map(([key, value]) => (
              <div key={key} className="rounded border border-white/10 bg-black/20 px-3 py-2 text-sm">
                <span className="text-slate-400">{statLabels[key][locale]}</span>{' '}
                <strong className="text-emerald-300">+{value}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {recipe.output.affixCount ? (
          <p className="rounded border border-sky-400/20 bg-sky-950/20 px-3 py-2 text-sm text-sky-100">
            {locale === 'pl'
              ? `Przedmiot otrzyma od ${recipe.output.affixCount.minimum} do ${recipe.output.affixCount.maximum} losowych afiksów.`
              : `The item rolls between ${recipe.output.affixCount.minimum} and ${recipe.output.affixCount.maximum} random affixes.`}
          </p>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          {recipe.output.relic ? (
            <div className="rounded border border-violet-400/30 bg-violet-950/20 p-3">
              <strong className="text-violet-200">{recipe.output.relic.name}</strong>
              <p className="mt-1 text-xs text-slate-300">{recipe.output.relic.description}</p>
            </div>
          ) : null}
          {recipe.output.curse ? (
            <div className="rounded border border-red-400/30 bg-red-950/20 p-3">
              <strong className="text-red-200">{recipe.output.curse.name}</strong>
              <p className="mt-1 text-xs text-slate-300">{recipe.output.curse.description}</p>
              <p className="mt-2 text-xs font-semibold text-red-200">{recipe.output.curse.preview}</p>
            </div>
          ) : null}
        </div>

        <div>
          <h4 className="text-sm font-bold uppercase tracking-wide text-amber-200">{locale === 'pl' ? 'Wymagane materiały' : 'Required materials'}</h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {recipe.inputs.map((input) => (
              <div key={input.itemKey} className={`flex items-center justify-between gap-3 rounded border bg-black/20 px-3 py-2 ${input.enough ? 'border-emerald-400/20' : 'border-red-400/35'}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <ItemIcon definitionKey={input.itemKey} fallback={input.icon} className="h-8 w-8 shrink-0" />
                  <span className="truncate text-sm">{input.name}</span>
                </div>
                <strong className={input.enough ? 'text-emerald-300' : 'text-red-300'}>{input.ownedQuantity}/{input.requiredQuantity}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-4">
          <div className="text-sm">
            <div className={recipe.availability.silverMet ? 'text-amber-200' : 'text-red-300'}>{locale === 'pl' ? 'Koszt' : 'Cost'}: <strong>{recipe.silverCost}</strong> {locale === 'pl' ? 'srebra' : 'silver'}</div>
            {reasons.map((reason) => <p key={reason} className="mt-1 text-xs text-red-300">{reason}</p>)}
          </div>
          <button type="button" className="hud-utility-button min-w-40" disabled={busy || !recipe.availability.canCraft} onClick={onCraft}>
            {busy ? (locale === 'pl' ? 'Wykuwanie…' : 'Crafting…') : recipe.availability.canCraft ? (locale === 'pl' ? 'Wytwórz przedmiot' : 'Craft item') : (locale === 'pl' ? 'Brak wymagań' : 'Requirements missing')}
          </button>
        </div>
      </div>
    </section>
  );
}
