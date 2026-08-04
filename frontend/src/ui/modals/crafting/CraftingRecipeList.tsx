import { ItemIcon } from '../../../components/common/ItemIcon';
import { rarityClasses } from '../../../components/common/ItemTooltip';
import type { CraftingRecipePayload } from '../../../contracts/crafting';

interface CraftingRecipeListProps {
  recipes: CraftingRecipePayload[];
  selectedKey: string | undefined;
  locale: 'en' | 'pl';
  onSelect: (recipeKey: string) => void;
}

export function CraftingRecipeList({
  recipes,
  selectedKey,
  locale,
  onSelect,
}: CraftingRecipeListProps): React.JSX.Element {
  return (
    <section className="rounded border border-amber-400/20 bg-black/20 p-3">
      <h3 className="modal-section-title">{locale === 'pl' ? 'Receptury' : 'Recipes'}</h3>
      <div className="mt-3 space-y-2">
        {recipes.length === 0 ? (
          <p className="text-sm text-slate-400">
            {locale === 'pl'
              ? 'To stanowisko nie ma dostępnych receptur.'
              : 'This workstation has no recipes.'}
          </p>
        ) : null}
        {recipes.map((recipe) => (
          <button
            key={recipe.key}
            type="button"
            className={`w-full rounded border p-3 text-left transition ${rarityClasses(recipe.output.rarity)} ${
              selectedKey === recipe.key
                ? 'bg-amber-950/45 ring-1 ring-amber-300/70'
                : 'bg-black/20 hover:bg-white/5'
            }`}
            onClick={() => onSelect(recipe.key)}
          >
            <div className="flex items-center gap-3">
              <ItemIcon
                definitionKey={recipe.output.definitionKey}
                fallback={recipe.output.icon}
                className="h-10 w-10 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <strong className="block truncate">{recipe.output.name}</strong>
                <span className="text-xs text-slate-400">
                  {recipe.silverCost} {locale === 'pl' ? 'srebra' : 'silver'}
                </span>
              </div>
              <span
                className={recipe.availability.canCraft ? 'text-emerald-300' : 'text-red-300'}
                aria-label={recipe.availability.canCraft ? 'available' : 'locked'}
              >
                {recipe.availability.canCraft ? '✓' : '×'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
