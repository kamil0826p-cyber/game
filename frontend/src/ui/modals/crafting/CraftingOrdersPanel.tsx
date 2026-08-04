import { useMemo, useState } from 'react';
import { ItemIcon } from '../../../components/common/ItemIcon';
import { rarityClasses } from '../../../components/common/ItemTooltip';
import type {
  CraftOrderFulfillBlocker,
  CraftOrderPayload,
  CraftingRecipePayload,
  CraftingSnapshot,
} from '../../../contracts/crafting';

type OrdersSection = 'BOARD' | 'MINE' | 'CREATE';

interface CraftingOrdersPanelProps {
  snapshot: CraftingSnapshot;
  locale: 'en' | 'pl';
  busy: boolean;
  onCreate: (recipeKey: string, rewardSilver: number) => void;
  onFulfill: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onRefresh: () => void;
}

const statusLabels = {
  OPEN: { en: 'Open', pl: 'Otwarte' },
  COMPLETED: { en: 'Completed', pl: 'Ukończone' },
  CANCELLED: { en: 'Cancelled', pl: 'Anulowane' },
  EXPIRED: { en: 'Expired', pl: 'Wygasłe' },
} as const;

const blockerLabels: Record<CraftOrderFulfillBlocker, { en: string; pl: string }> = {
  OWN_ORDER: { en: 'You cannot fulfill your own order.', pl: 'Nie możesz wykonać własnego zlecenia.' },
  LEVEL_REQUIRED: { en: 'Your character level is too low.', pl: 'Poziom twojej postaci jest zbyt niski.' },
  REGION_REQUIRED: { en: 'This order requires another region.', pl: 'To zlecenie wymaga innego regionu.' },
  WRONG_WORKSTATION: { en: 'This order requires another workstation.', pl: 'To zlecenie wymaga innego stanowiska.' },
  RECIPE_VERSION_MISMATCH: { en: 'The recipe is outdated.', pl: 'Receptura jest nieaktualna.' },
  ORDER_CLOSED: { en: 'This order is no longer open.', pl: 'To zlecenie nie jest już otwarte.' },
};

const formatRemaining = (expiresAt: number, locale: 'en' | 'pl'): string => {
  const remaining = Math.max(0, expiresAt - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return locale === 'pl' ? `${days} d ${hours % 24} godz.` : `${days}d ${hours % 24}h`;
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return locale === 'pl' ? `${minutes} min` : `${minutes}m`;
};

function OrderCard({
  order,
  locale,
  busy,
  mode,
  onFulfill,
  onCancel,
}: {
  order: CraftOrderPayload;
  locale: 'en' | 'pl';
  busy: boolean;
  mode: 'BOARD' | 'MINE';
  onFulfill: (orderId: string) => void;
  onCancel: (orderId: string) => void;
}): React.JSX.Element {
  const confirmFulfill = (): void => {
    const accepted = window.confirm(
      locale === 'pl'
        ? `Wykonać zlecenie „${order.output.name}” dla gracza ${order.owner.name}?\n\nOtrzymasz ${order.rewardSilver} srebra. Materiały zapewnia zleceniodawca.`
        : `Fulfill “${order.output.name}” for ${order.owner.name}?\n\nYou will receive ${order.rewardSilver} silver. The owner provides all materials.`,
    );
    if (accepted) onFulfill(order.id);
  };
  const confirmCancel = (): void => {
    const accepted = window.confirm(
      locale === 'pl'
        ? `Anulować zlecenie „${order.output.name}”? Wszystkie materiały oraz ${order.totalEscrowSilver} srebra wrócą do ciebie.`
        : `Cancel “${order.output.name}”? All materials and ${order.totalEscrowSilver} silver will be returned.`,
    );
    if (accepted) onCancel(order.id);
  };

  return (
    <article className={`rounded border bg-black/20 p-4 ${rarityClasses(order.output.rarity)}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ItemIcon
            definitionKey={order.output.definitionKey}
            fallback={order.output.icon}
            className="h-12 w-12 shrink-0"
          />
          <div className="min-w-0">
            <strong className="block truncate text-amber-100">
              {order.outputQuantity} × {order.output.name}
            </strong>
            <p className="mt-1 text-xs text-slate-400">
              {locale === 'pl' ? 'Zleceniodawca' : 'Owner'}: {order.owner.name}
            </p>
            {order.crafter ? (
              <p className="text-xs text-slate-400">
                {locale === 'pl' ? 'Wykonawca' : 'Crafter'}: {order.crafter.name}
              </p>
            ) : null}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-bold text-emerald-300">
            {locale === 'pl' ? 'Nagroda' : 'Reward'}: {order.rewardSilver}
          </div>
          <div className="text-slate-400">
            {locale === 'pl' ? 'Koszt receptury' : 'Recipe cost'}: {order.craftCostSilver}
          </div>
          <div className="mt-1 text-slate-500">
            {statusLabels[order.status][locale]}
            {order.status === 'OPEN' ? ` · ${formatRemaining(order.expiresAt, locale)}` : ''}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
        <span>{locale === 'pl' ? 'Wymagany poziom' : 'Required level'}: {order.requiredLevel}</span>
        <span>• {order.output.rarity}</span>
        {order.output.requiredClass ? <span>• {order.output.requiredClass}</span> : null}
      </div>

      {mode === 'BOARD' && order.fulfillBlockers.length > 0 ? (
        <div className="mt-3 space-y-1">
          {order.fulfillBlockers.map((blocker) => (
            <p key={blocker} className="text-xs text-red-300">
              {blockerLabels[blocker][locale]}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        {mode === 'BOARD' ? (
          <button
            type="button"
            className="hud-utility-button"
            disabled={busy || !order.canFulfill}
            onClick={confirmFulfill}
          >
            {locale === 'pl' ? `Wykonaj za ${order.rewardSilver}` : `Fulfill for ${order.rewardSilver}`}
          </button>
        ) : order.canCancel ? (
          <button
            type="button"
            className="hud-utility-button"
            disabled={busy}
            onClick={confirmCancel}
          >
            {locale === 'pl' ? 'Anuluj i odbierz escrow' : 'Cancel and refund escrow'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function CreateOrder({
  snapshot,
  locale,
  busy,
  onCreate,
}: {
  snapshot: CraftingSnapshot;
  locale: 'en' | 'pl';
  busy: boolean;
  onCreate: (recipeKey: string, rewardSilver: number) => void;
}): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState(snapshot.recipes[0]?.key ?? '');
  const [rewardText, setRewardText] = useState('0');
  const selected = useMemo(
    () => snapshot.recipes.find((recipe) => recipe.key === selectedKey) ?? snapshot.recipes[0],
    [selectedKey, snapshot.recipes],
  );
  const reward = Number(rewardText);
  const rewardValid =
    Number.isInteger(reward) &&
    reward >= 0 &&
    reward <= snapshot.orders.rules.maximumRewardSilver;
  const total = selected ? selected.silverCost + (rewardValid ? reward : 0) : 0;
  const canCreate = Boolean(
    selected?.orderAvailability.canCreate && rewardValid && total <= snapshot.silver,
  );

  const create = (): void => {
    if (!selected || !canCreate) return;
    const materials = selected.inputs
      .map((input) => `• ${input.requiredQuantity} × ${input.name}`)
      .join('\n');
    const accepted = window.confirm(
      locale === 'pl'
        ? `Wystawić zlecenie na „${selected.output.name}”?\n\nDo escrow trafi:\n${materials}\n• ${selected.silverCost} srebra kosztu receptury\n• ${reward} srebra nagrody\n\nŁącznie: ${total} srebra. Zlecenie wygaśnie po 7 dniach.`
        : `Post an order for “${selected.output.name}”?\n\nEscrow receives:\n${materials}\n• ${selected.silverCost} silver recipe cost\n• ${reward} silver reward\n\nTotal: ${total} silver. The order expires after 7 days.`,
    );
    if (accepted) onCreate(selected.key, reward);
  };

  if (!selected) {
    return <p className="py-10 text-center text-sm text-slate-400">{locale === 'pl' ? 'Brak receptur dla tego stanowiska.' : 'No recipes for this workstation.'}</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.4fr)]">
      <section className="rounded border border-amber-400/20 bg-black/20 p-4">
        <h3 className="modal-section-title">{locale === 'pl' ? 'Nowe zlecenie' : 'New order'}</h3>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400">
          {locale === 'pl' ? 'Receptura' : 'Recipe'}
          <select
            className="mt-2 w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={selected.key}
            onChange={(event) => setSelectedKey(event.target.value)}
          >
            {snapshot.recipes.map((recipe) => (
              <option key={recipe.key} value={recipe.key}>{recipe.output.name}</option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400">
          {locale === 'pl' ? 'Nagroda dla wykonawcy' : 'Crafter reward'}
          <input
            type="number"
            min={0}
            max={snapshot.orders.rules.maximumRewardSilver}
            step={1}
            value={rewardText}
            onChange={(event) => setRewardText(event.target.value)}
            className="mt-2 w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <div className="mt-4 rounded border border-amber-400/20 bg-black/25 p-3 text-sm">
          <div className="flex justify-between"><span>{locale === 'pl' ? 'Koszt receptury' : 'Recipe cost'}</span><strong>{selected.silverCost}</strong></div>
          <div className="mt-1 flex justify-between"><span>{locale === 'pl' ? 'Nagroda' : 'Reward'}</span><strong>{rewardValid ? reward : '—'}</strong></div>
          <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-amber-200"><span>{locale === 'pl' ? 'Łączne escrow' : 'Total escrow'}</span><strong>{total}</strong></div>
          <div className="mt-1 flex justify-between text-xs text-slate-400"><span>{locale === 'pl' ? 'Posiadasz' : 'Available'}</span><span>{snapshot.silver}</span></div>
        </div>
        <button type="button" className="hud-utility-button mt-4 w-full" disabled={busy || !canCreate} onClick={create}>
          {locale === 'pl' ? 'Wystaw zlecenie' : 'Post order'}
        </button>
      </section>

      <section className={`rounded border bg-black/20 p-4 ${rarityClasses(selected.output.rarity)}`}>
        <div className="flex items-start gap-4">
          <ItemIcon definitionKey={selected.output.definitionKey} fallback={selected.output.icon} className="h-14 w-14 shrink-0" />
          <div>
            <h3 className="font-display text-2xl text-amber-100">{selected.output.name}</h3>
            <p className="mt-1 text-sm text-slate-300">{selected.output.description}</p>
            <p className="mt-2 text-xs text-slate-400">
              {locale === 'pl'
                ? `Wykonawca musi mieć poziom ${selected.requiredLevel}. Twój poziom nie ogranicza wystawienia zlecenia.`
                : `The crafter must be level ${selected.requiredLevel}. Your own level does not restrict posting the order.`}
            </p>
          </div>
        </div>
        <h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-amber-200">{locale === 'pl' ? 'Materiały przekazywane do escrow' : 'Materials placed in escrow'}</h4>
        <div className="mt-2 space-y-2">
          {selected.inputs.map((input) => (
            <div key={input.itemKey} className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${input.enough ? 'border-emerald-400/20' : 'border-red-400/35'}`}>
              <span>{input.name}</span>
              <strong className={input.enough ? 'text-emerald-300' : 'text-red-300'}>{input.ownedQuantity}/{input.requiredQuantity}</strong>
            </div>
          ))}
        </div>
        {!selected.orderAvailability.activeOrderLimitMet ? (
          <p className="mt-3 text-xs text-red-300">{locale === 'pl' ? 'Osiągnięto limit aktywnych zleceń.' : 'You reached the active order limit.'}</p>
        ) : null}
        {!rewardValid ? (
          <p className="mt-3 text-xs text-red-300">{locale === 'pl' ? 'Nagroda musi być nieujemną liczbą całkowitą w dozwolonym limicie.' : 'Reward must be a non-negative whole number within the allowed limit.'}</p>
        ) : null}
        {total > snapshot.silver ? (
          <p className="mt-3 text-xs text-red-300">{locale === 'pl' ? `Brakuje ${total - snapshot.silver} srebra.` : `You need ${total - snapshot.silver} more silver.`}</p>
        ) : null}
      </section>
    </div>
  );
}

export function CraftingOrdersPanel({
  snapshot,
  locale,
  busy,
  onCreate,
  onFulfill,
  onCancel,
  onRefresh,
}: CraftingOrdersPanelProps): React.JSX.Element {
  const [section, setSection] = useState<OrdersSection>('BOARD');
  const sections: Array<{ key: OrdersSection; label: string }> = [
    { key: 'BOARD', label: locale === 'pl' ? 'Tablica zleceń' : 'Order board' },
    { key: 'MINE', label: locale === 'pl' ? 'Moje zlecenia' : 'My orders' },
    { key: 'CREATE', label: locale === 'pl' ? 'Wystaw zlecenie' : 'Post order' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {sections.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`hud-utility-button ${section === entry.key ? 'ring-1 ring-amber-300/70' : ''}`}
              onClick={() => setSection(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>{locale === 'pl' ? 'Aktywne' : 'Active'}: {snapshot.orders.rules.activeOrderCount}/{snapshot.orders.rules.activeOrderLimit}</span>
          <button type="button" className="hud-utility-button" disabled={busy} onClick={onRefresh}>
            {locale === 'pl' ? 'Odśwież' : 'Refresh'}
          </button>
        </div>
      </div>

      {section === 'CREATE' ? (
        <CreateOrder snapshot={snapshot} locale={locale} busy={busy} onCreate={onCreate} />
      ) : (
        <div className="space-y-3">
          {(section === 'BOARD' ? snapshot.orders.board : snapshot.orders.mine).length === 0 ? (
            <p className="rounded border border-white/10 bg-black/20 py-10 text-center text-sm text-slate-400">
              {section === 'BOARD'
                ? locale === 'pl' ? 'Nie ma obecnie otwartych zleceń.' : 'There are no open orders.'
                : locale === 'pl' ? 'Nie masz jeszcze zleceń.' : 'You have no orders yet.'}
            </p>
          ) : null}
          {(section === 'BOARD' ? snapshot.orders.board : snapshot.orders.mine).map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              locale={locale}
              busy={busy}
              mode={section}
              onFulfill={onFulfill}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
