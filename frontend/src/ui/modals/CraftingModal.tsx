import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CraftOrderMutationResult,
  CraftingResult,
  CraftingSnapshot,
} from '../../contracts/crafting';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { CraftingOrdersPanel } from './crafting/CraftingOrdersPanel';
import { CraftingRecipeDetails } from './crafting/CraftingRecipeDetails';
import { CraftingRecipeList } from './crafting/CraftingRecipeList';
import { Modal } from './Modal';

interface CraftingModalProps {
  npcName: string;
  onClose: () => void;
}

type ForgeView = 'CRAFT' | 'ORDERS';

export function CraftingModal({ npcName, onClose }: CraftingModalProps): React.JSX.Element {
  const connection = useGameConnection();
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<CraftingSnapshot>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [view, setView] = useState<ForgeView>('CRAFT');
  const [busy, setBusy] = useState(false);
  const [lastCraft, setLastCraft] = useState<CraftingResult['crafted']>();
  const [lastOrder, setLastOrder] = useState<CraftOrderMutationResult['mutation']>();

  const applySnapshot = useCallback((value: CraftingSnapshot) => {
    setSnapshot(value);
    setSelectedKey((current) =>
      value.recipes.some((recipe) => recipe.key === current)
        ? current
        : value.recipes[0]?.key,
    );
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    applySnapshot(await connection.getCrafting());
  }, [applySnapshot, connection]);

  useEffect(() => {
    let mounted = true;
    void connection
      .getCrafting()
      .then((value) => {
        if (mounted) applySnapshot(value);
      })
      .catch(onClose);
    return () => {
      mounted = false;
    };
  }, [applySnapshot, connection, onClose]);

  useEffect(() => {
    if (view !== 'ORDERS') return;
    const interval = window.setInterval(() => {
      if (!busy) void refresh().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [busy, refresh, view]);

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
      const result = await connection.craftRecipe(selected.key, selected.version);
      applySnapshot(result.snapshot);
      setLastCraft(result.crafted);
      setLastOrder(undefined);
      setSelectedKey(selected.key);
    } catch {
      try {
        await refresh();
        setLastCraft(undefined);
      } catch {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const mutateOrder = async (
    operation: () => Promise<CraftOrderMutationResult>,
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await operation();
      applySnapshot(result.snapshot);
      setLastOrder(result.mutation);
      setLastCraft(undefined);
    } catch {
      try {
        await refresh();
      } catch {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const orderMessage = (): string | undefined => {
    if (!lastOrder) return undefined;
    if (lastOrder.kind === 'CREATED') {
      return locale === 'pl'
        ? `Wystawiono zlecenie na ${lastOrder.outputName}.`
        : `Posted an order for ${lastOrder.outputName}.`;
    }
    if (lastOrder.kind === 'CANCELLED') {
      return locale === 'pl'
        ? `Anulowano zlecenie na ${lastOrder.outputName}; materiały i srebro wróciły do ciebie.`
        : `Cancelled the order for ${lastOrder.outputName}; materials and silver were refunded.`;
    }
    return locale === 'pl'
      ? `Wykonano zlecenie na ${lastOrder.outputName}. Otrzymujesz ${lastOrder.rewardSilver} srebra.`
      : `Fulfilled the order for ${lastOrder.outputName}. You received ${lastOrder.rewardSilver} silver.`;
  };

  return (
    <Modal
      title={locale === 'pl' ? `Kuźnia — ${snapshot?.station.npcName ?? npcName}` : `Forge — ${snapshot?.station.npcName ?? npcName}`}
      subtitle={
        locale === 'pl'
          ? 'Wytwarzaj przedmioty lub korzystaj ze zleceń rzemieślniczych innych graczy.'
          : 'Craft items or use player-to-player craft orders.'
      }
      icon="⚒"
      onClose={onClose}
      widthClass="max-w-6xl"
    >
      {!snapshot ? (
        <p className="py-10 text-center text-sm text-slate-400">
          {locale === 'pl' ? 'Otwieranie kuźni…' : 'Opening the forge…'}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-400/20 bg-black/25 px-4 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                className={`hud-utility-button ${view === 'CRAFT' ? 'ring-1 ring-amber-300/70' : ''}`}
                onClick={() => setView('CRAFT')}
              >
                {locale === 'pl' ? 'Wytwarzanie' : 'Crafting'}
              </button>
              <button
                type="button"
                className={`hud-utility-button ${view === 'ORDERS' ? 'ring-1 ring-amber-300/70' : ''}`}
                onClick={() => setView('ORDERS')}
              >
                {locale === 'pl' ? 'Zlecenia graczy' : 'Player orders'}
              </button>
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>
                {locale === 'pl' ? 'Srebro' : 'Silver'}:{' '}
                <strong className="text-amber-200">{snapshot.silver}</strong>
              </div>
              <div>{locale === 'pl' ? 'Poziom postaci' : 'Character level'}: {snapshot.characterLevel}</div>
              <div>{locale === 'pl' ? 'Region' : 'Region'}: {snapshot.mapKey}</div>
            </div>
          </div>

          {lastCraft ? (
            <div className="rounded border border-emerald-400/35 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100" role="status" aria-live="polite">
              <strong>
                {locale === 'pl'
                  ? `Wytworzono ${lastCraft.quantity} × ${lastCraft.name}.`
                  : `Crafted ${lastCraft.quantity} × ${lastCraft.name}.`}
              </strong>{' '}
              {lastCraft.delivery === 'CLAIMS'
                ? locale === 'pl'
                  ? 'Plecak był pełny, więc przedmiot trafił do kolejki nagród.'
                  : 'Your backpack was full, so the item was sent to the rewards queue.'
                : locale === 'pl'
                  ? 'Przedmiot trafił do plecaka.'
                  : 'The item was added to your backpack.'}
            </div>
          ) : null}

          {lastOrder ? (
            <div className="rounded border border-emerald-400/35 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100" role="status" aria-live="polite">
              {orderMessage()}
            </div>
          ) : null}

          {view === 'CRAFT' ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
              <CraftingRecipeList
                recipes={snapshot.recipes}
                selectedKey={selected?.key}
                locale={locale}
                onSelect={(recipeKey) => {
                  setSelectedKey(recipeKey);
                  setLastCraft(undefined);
                  setLastOrder(undefined);
                }}
              />
              <CraftingRecipeDetails
                recipe={selected}
                silver={snapshot.silver}
                locale={locale}
                busy={busy}
                onCraft={() => void craft()}
              />
            </div>
          ) : (
            <CraftingOrdersPanel
              snapshot={snapshot}
              locale={locale}
              busy={busy}
              onCreate={(recipeKey, rewardSilver) =>
                void mutateOrder(() => connection.createCraftOrder(recipeKey, rewardSilver))
              }
              onFulfill={(orderId) =>
                void mutateOrder(() => connection.fulfillCraftOrder(orderId))
              }
              onCancel={(orderId) =>
                void mutateOrder(() => connection.cancelCraftOrder(orderId))
              }
              onRefresh={() => void refresh().catch(onClose)}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
