import { useEffect, useMemo, useState } from 'react';
import type { CraftingResult, CraftingSnapshot } from '../../contracts/crafting';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { CraftingRecipeDetails } from './crafting/CraftingRecipeDetails';
import { CraftingRecipeList } from './crafting/CraftingRecipeList';
import { Modal } from './Modal';

interface CraftingModalProps {
  npcName: string;
  onClose: () => void;
}

export function CraftingModal({ npcName, onClose }: CraftingModalProps): React.JSX.Element {
  const connection = useGameConnection();
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<CraftingSnapshot>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lastCraft, setLastCraft] = useState<CraftingResult['crafted']>();

  useEffect(() => {
    let mounted = true;
    void connection
      .getCrafting()
      .then((value) => {
        if (!mounted) return;
        setSnapshot(value);
        setSelectedKey(value.recipes[0]?.key);
      })
      .catch(onClose);
    return () => {
      mounted = false;
    };
  }, [connection, onClose]);

  const selected = useMemo(
    () => snapshot?.recipes.find((recipe) => recipe.key === selectedKey) ?? snapshot?.recipes[0],
    [selectedKey, snapshot],
  );

  const confirmCraft = (): boolean => {
    if (!selected) return false;
    const materials = selected.inputs
      .map((input) => `• ${input.requiredQuantity} × ${input.name}`)
      .join('\n');
    return window.confirm(
      locale === 'pl'
        ? `Wytworzyć „${selected.output.name}”?\n\nZużyjesz:\n${materials}\n• ${selected.silverCost} srebra\n\nMateriałów i srebra nie można odzyskać.`
        : `Craft “${selected.output.name}”?\n\nThis consumes:\n${materials}\n• ${selected.silverCost} silver\n\nThe materials and silver cannot be recovered.`,
    );
  };

  const craft = async (): Promise<void> => {
    if (!selected || busy || !selected.availability.canCraft || !confirmCraft()) return;
    setBusy(true);
    try {
      const result = await connection.craftRecipe(selected.key);
      setSnapshot(result.snapshot);
      setLastCraft(result.crafted);
      setSelectedKey(selected.key);
    } catch {
      // The socket bridge reports the authoritative localized error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={locale === 'pl' ? `Kuźnia — ${snapshot?.station.npcName ?? npcName}` : `Forge — ${snapshot?.station.npcName ?? npcName}`}
      subtitle={locale === 'pl' ? 'Wybierz recepturę, sprawdź wymagania i wytwórz przedmiot.' : 'Choose a recipe, review its requirements, and craft the item.'}
      icon="⚒"
      onClose={onClose}
      widthClass="max-w-6xl"
    >
      {!snapshot ? (
        <p className="py-10 text-center text-sm text-slate-400">{locale === 'pl' ? 'Otwieranie kuźni…' : 'Opening the forge…'}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-400/20 bg-black/25 px-4 py-3">
            <div>
              <strong className="block text-amber-100">{locale === 'pl' ? 'Dostępne srebro' : 'Available silver'}</strong>
              <span className="text-sm text-amber-200">{snapshot.silver}</span>
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>{locale === 'pl' ? 'Poziom postaci' : 'Character level'}: {snapshot.characterLevel}</div>
              <div>{locale === 'pl' ? 'Region' : 'Region'}: {snapshot.mapKey}</div>
            </div>
          </div>

          {lastCraft ? (
            <div className="rounded border border-emerald-400/35 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100" role="status" aria-live="polite">
              <strong>{locale === 'pl' ? `Wytworzono ${lastCraft.quantity} × ${lastCraft.name}.` : `Crafted ${lastCraft.quantity} × ${lastCraft.name}.`}</strong>{' '}
              {lastCraft.delivery === 'CLAIMS'
                ? locale === 'pl' ? 'Plecak był pełny, więc przedmiot trafił do kolejki nagród.' : 'Your backpack was full, so the item was sent to the rewards queue.'
                : locale === 'pl' ? 'Przedmiot trafił do plecaka.' : 'The item was added to your backpack.'}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
            <CraftingRecipeList
              recipes={snapshot.recipes}
              selectedKey={selected?.key}
              locale={locale}
              onSelect={(recipeKey) => {
                setSelectedKey(recipeKey);
                setLastCraft(undefined);
              }}
            />
            <CraftingRecipeDetails recipe={selected} silver={snapshot.silver} locale={locale} busy={busy} onCraft={() => void craft()} />
          </div>
        </div>
      )}
    </Modal>
  );
}
