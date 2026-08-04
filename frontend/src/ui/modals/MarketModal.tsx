import { useCallback, useEffect, useMemo, useState } from 'react';
import { ItemIcon } from '../../components/common/ItemIcon';
import { rarityClasses } from '../../components/common/ItemTooltip';
import type {
  MarketListingPayload,
  MarketMutationResult,
  MarketSellableItemPayload,
  MarketSnapshot,
} from '../../contracts/market';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

type MarketView = 'BROWSE' | 'MINE' | 'SELL';
type MarketSort = 'PRICE_ASC' | 'PRICE_DESC' | 'NEWEST' | 'EXPIRING';

interface MarketModalProps {
  npcName: string;
  onClose: () => void;
}

const formatRemaining = (expiresAt: number, locale: 'en' | 'pl'): string => {
  const remaining = Math.max(0, expiresAt - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return locale === 'pl' ? `${days} d ${hours % 24} godz.` : `${days}d ${hours % 24}h`;
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return locale === 'pl' ? `${minutes} min` : `${minutes}m`;
};

const statEntries = (stats: Record<string, number | undefined>): Array<[string, number]> =>
  Object.entries(stats).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0);

function ItemSummary({ item, locale }: { item: MarketListingPayload['item']; locale: 'en' | 'pl' }): React.JSX.Element {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">{item.description}</p>
      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
        <span>{item.rarity}</span>
        <span>• {item.category}</span>
        <span>• {locale === 'pl' ? 'Moc' : 'Power'} {item.powerLevel}</span>
        <span>• {locale === 'pl' ? 'Jakość' : 'Quality'} {item.craftQuality}</span>
        <span>• {locale === 'pl' ? 'Poziom' : 'Level'} {item.minimumLevel}</span>
        {item.requiredClass ? <span>• {item.requiredClass}</span> : null}
      </div>
      {statEntries(item.statBonuses).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {statEntries(item.statBonuses).map(([key, value]) => (
            <span key={key} className="rounded border border-emerald-400/20 bg-emerald-950/25 px-2 py-1 text-xs text-emerald-200">
              {key} {value > 0 ? '+' : ''}{value}
            </span>
          ))}
        </div>
      ) : null}
      {item.affixes.length > 0 ? (
        <div>
          <strong className="text-xs uppercase tracking-wide text-amber-200">{locale === 'pl' ? 'Afiksy' : 'Affixes'}</strong>
          <div className="mt-1 space-y-1">
            {item.affixes.map((affix, index) => (
              <div key={`${affix.name}-${index}`} className="text-xs text-sky-200">
                T{affix.tier} {affix.name}
                {statEntries(affix.statBonuses).map(([key, value]) => ` · ${key} ${value > 0 ? '+' : ''}${value}`).join('')}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {item.relic ? (
        <div className="rounded border border-violet-400/25 bg-violet-950/25 p-2 text-xs text-violet-100">
          <strong>{item.relic.name}</strong>
          <p className="mt-1 text-violet-200/80">{item.relic.description}</p>
        </div>
      ) : null}
      {item.curse ? (
        <div className="rounded border border-red-400/25 bg-red-950/25 p-2 text-xs text-red-100">
          <strong>{item.curse.name}</strong>
          <p className="mt-1 text-red-200/80">{item.curse.preview}</p>
        </div>
      ) : null}
    </div>
  );
}

function ListingCard({
  listing,
  locale,
  busy,
  mode,
  onBuy,
  onCancel,
}: {
  listing: MarketListingPayload;
  locale: 'en' | 'pl';
  busy: boolean;
  mode: 'BROWSE' | 'MINE';
  onBuy: (listingId: string) => void;
  onCancel: (listingId: string) => void;
}): React.JSX.Element {
  const buy = (): void => {
    const accepted = window.confirm(
      locale === 'pl'
        ? `Kupić ${listing.quantity} × „${listing.item.name}” za ${listing.totalPriceSilver} srebra?`
        : `Buy ${listing.quantity} × “${listing.item.name}” for ${listing.totalPriceSilver} silver?`,
    );
    if (accepted) onBuy(listing.id);
  };
  const cancel = (): void => {
    const accepted = window.confirm(
      locale === 'pl'
        ? `Anulować ofertę „${listing.item.name}”? Opłata ${listing.listingFeeSilver} srebra nie zostanie zwrócona.`
        : `Cancel “${listing.item.name}”? The ${listing.listingFeeSilver} silver listing fee will not be refunded.`,
    );
    if (accepted) onCancel(listing.id);
  };

  return (
    <article className={`rounded border bg-black/25 p-4 ${rarityClasses(listing.item.rarity)}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ItemIcon definitionKey={listing.item.definitionKey} fallback={listing.item.icon} className="h-14 w-14 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-display text-lg text-amber-100">{listing.quantity} × {listing.item.name}</h3>
            <p className="text-xs text-slate-400">
              {locale === 'pl' ? 'Sprzedawca' : 'Seller'}: {listing.seller.name}
              {listing.buyer ? ` · ${locale === 'pl' ? 'Kupujący' : 'Buyer'}: ${listing.buyer.name}` : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <strong className="block text-lg text-emerald-300">{listing.totalPriceSilver}</strong>
          <span className="text-xs text-slate-400">{listing.unitPriceSilver} / szt.</span>
          <div className="mt-1 text-xs text-slate-500">
            {listing.status}{listing.status === 'ACTIVE' ? ` · ${formatRemaining(listing.expiresAt, locale)}` : ''}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <ItemSummary item={listing.item} locale={locale} />
      </div>
      <div className="mt-4 grid gap-2 rounded border border-white/10 bg-black/20 p-3 text-xs sm:grid-cols-3">
        <div><span className="text-slate-500">{locale === 'pl' ? 'Mediana/szt.' : 'Median/unit'}</span><strong className="block text-slate-200">{listing.historicalMedianUnitPriceSilver ?? '—'}</strong></div>
        <div><span className="text-slate-500">{locale === 'pl' ? 'Prowizja' : 'Commission'}</span><strong className="block text-slate-200">{listing.commissionSilver}</strong></div>
        <div><span className="text-slate-500">{locale === 'pl' ? 'Sprzedawca otrzyma' : 'Seller receives'}</span><strong className="block text-slate-200">{listing.sellerRevenueSilver}</strong></div>
      </div>
      <div className="mt-4 flex justify-end">
        {mode === 'BROWSE' ? (
          <button type="button" className="hud-utility-button" disabled={busy || !listing.canBuy} onClick={buy}>
            {locale === 'pl' ? `Kup za ${listing.totalPriceSilver}` : `Buy for ${listing.totalPriceSilver}`}
          </button>
        ) : listing.canCancel ? (
          <button type="button" className="hud-utility-button" disabled={busy} onClick={cancel}>
            {locale === 'pl' ? 'Anuluj ofertę' : 'Cancel listing'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function SellPanel({
  snapshot,
  locale,
  busy,
  onList,
}: {
  snapshot: MarketSnapshot;
  locale: 'en' | 'pl';
  busy: boolean;
  onList: (itemId: string, quantity: number, totalPriceSilver: number) => void;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(snapshot.sellableItems[0]?.inventoryItemId ?? '');
  const [quantityText, setQuantityText] = useState('1');
  const [unitPriceText, setUnitPriceText] = useState('1');
  const selected = useMemo<MarketSellableItemPayload | undefined>(
    () => snapshot.sellableItems.find((item) => item.inventoryItemId === selectedId) ?? snapshot.sellableItems[0],
    [selectedId, snapshot.sellableItems],
  );
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.inventoryItemId);
    setQuantityText((value) => String(Math.min(Math.max(1, Number(value) || 1), selected.quantity)));
    setUnitPriceText(String(selected.suggestedUnitPriceSilver ?? 1));
  }, [selected?.inventoryItemId]);
  const quantity = Number(quantityText);
  const unitPrice = Number(unitPriceText);
  const total = Number.isInteger(quantity) && Number.isInteger(unitPrice) ? quantity * unitPrice : 0;
  const fee = Math.max(1, Math.floor(total * snapshot.rules.listingFeeRate));
  const valid = Boolean(
    selected &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= selected.quantity &&
    Number.isInteger(unitPrice) &&
    unitPrice >= 1 &&
    total >= snapshot.rules.minimumPriceSilver &&
    total <= snapshot.rules.maximumPriceSilver &&
    fee <= snapshot.silver &&
    snapshot.rules.activeListingCount < snapshot.rules.activeListingLimit,
  );
  const submit = (): void => {
    if (!selected || !valid) return;
    const accepted = window.confirm(
      locale === 'pl'
        ? `Wystawić ${quantity} × „${selected.item.name}” za łącznie ${total} srebra?\n\nOpłata za wystawienie: ${fee} srebra. Opłata nie jest zwracana po anulowaniu.`
        : `List ${quantity} × “${selected.item.name}” for ${total} silver total?\n\nListing fee: ${fee} silver. The fee is not refunded after cancellation.`,
    );
    if (accepted) onList(selected.inventoryItemId, quantity, total);
  };

  if (!selected) {
    return <p className="rounded border border-white/10 bg-black/20 py-12 text-center text-sm text-slate-400">{locale === 'pl' ? 'Nie masz przedmiotów, które można wystawić.' : 'You have no items that can be listed.'}</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)]">
      <section className="rounded border border-amber-400/20 bg-black/20 p-4">
        <h3 className="modal-section-title">{locale === 'pl' ? 'Nowa oferta' : 'New listing'}</h3>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400">
          {locale === 'pl' ? 'Przedmiot' : 'Item'}
          <select className="mt-2 w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={selected.inventoryItemId} onChange={(event) => setSelectedId(event.target.value)}>
            {snapshot.sellableItems.map((item) => <option key={item.inventoryItemId} value={item.inventoryItemId}>{item.quantity} × {item.item.name}</option>)}
          </select>
        </label>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {locale === 'pl' ? 'Ilość' : 'Quantity'}
            <input type="number" min={1} max={selected.quantity} step={1} value={quantityText} onChange={(event) => setQuantityText(event.target.value)} className="mt-2 w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {locale === 'pl' ? 'Cena za sztukę' : 'Unit price'}
            <input type="number" min={1} step={1} value={unitPriceText} onChange={(event) => setUnitPriceText(event.target.value)} className="mt-2 w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
        </div>
        <div className="mt-4 space-y-2 rounded border border-white/10 bg-black/25 p-3 text-sm">
          <div className="flex justify-between"><span>{locale === 'pl' ? 'Łączna cena' : 'Total price'}</span><strong>{total || '—'}</strong></div>
          <div className="flex justify-between"><span>{locale === 'pl' ? 'Opłata 2%' : '2% listing fee'}</span><strong>{total ? fee : '—'}</strong></div>
          <div className="flex justify-between text-slate-400"><span>{locale === 'pl' ? 'Mediana/szt.' : 'Median/unit'}</span><span>{selected.suggestedUnitPriceSilver ?? '—'}</span></div>
          <div className="flex justify-between text-slate-400"><span>{locale === 'pl' ? 'Dostępne srebro' : 'Available silver'}</span><span>{snapshot.silver}</span></div>
        </div>
        <button type="button" className="hud-utility-button mt-4 w-full" disabled={busy || !valid} onClick={submit}>{locale === 'pl' ? 'Wystaw ofertę' : 'Create listing'}</button>
      </section>
      <section className={`rounded border bg-black/20 p-4 ${rarityClasses(selected.item.rarity)}`}>
        <div className="flex items-start gap-4">
          <ItemIcon definitionKey={selected.item.definitionKey} fallback={selected.item.icon} className="h-16 w-16 shrink-0" />
          <div><h3 className="font-display text-2xl text-amber-100">{selected.item.name}</h3><p className="text-xs text-slate-400">{locale === 'pl' ? 'Dostępna ilość' : 'Available quantity'}: {selected.quantity}</p></div>
        </div>
        <div className="mt-4"><ItemSummary item={selected.item} locale={locale} /></div>
      </section>
    </div>
  );
}

export function MarketModal({ npcName, onClose }: MarketModalProps): React.JSX.Element {
  const connection = useGameConnection();
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<MarketSnapshot>();
  const [view, setView] = useState<MarketView>('BROWSE');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [sort, setSort] = useState<MarketSort>('PRICE_ASC');
  const [lastMutation, setLastMutation] = useState<MarketMutationResult['mutation']>();

  const refresh = useCallback(async (): Promise<void> => {
    setSnapshot(await connection.getMarket());
  }, [connection]);

  useEffect(() => {
    let mounted = true;
    void connection.getMarket().then((value) => { if (mounted) setSnapshot(value); }).catch(onClose);
    return () => { mounted = false; };
  }, [connection, onClose]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!busy) void refresh().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [busy, refresh]);

  const mutate = async (operation: () => Promise<MarketMutationResult>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await operation();
      setSnapshot(result.snapshot);
      setLastMutation(result.mutation);
    } catch {
      try { await refresh(); } catch { onClose(); }
    } finally {
      setBusy(false);
    }
  };

  const visibleListings = useMemo(() => {
    if (!snapshot) return [];
    const normalized = query.trim().toLocaleLowerCase(locale);
    return snapshot.listings
      .filter((listing) => !normalized || listing.item.name.toLocaleLowerCase(locale).includes(normalized) || listing.seller.name.toLocaleLowerCase(locale).includes(normalized))
      .filter((listing) => rarity === 'ALL' || listing.item.rarity === rarity)
      .filter((listing) => category === 'ALL' || listing.item.category === category)
      .sort((left, right) => {
        if (sort === 'PRICE_DESC') return right.unitPriceSilver - left.unitPriceSilver;
        if (sort === 'NEWEST') return right.createdAt - left.createdAt;
        if (sort === 'EXPIRING') return left.expiresAt - right.expiresAt;
        return left.unitPriceSilver - right.unitPriceSilver;
      });
  }, [category, locale, query, rarity, snapshot, sort]);

  const mutationMessage = (): string | undefined => {
    if (!lastMutation) return undefined;
    if (lastMutation.kind === 'LISTED') return locale === 'pl' ? `Wystawiono ${lastMutation.quantity} × ${lastMutation.itemName}.` : `Listed ${lastMutation.quantity} × ${lastMutation.itemName}.`;
    if (lastMutation.kind === 'CANCELLED') return locale === 'pl' ? `Anulowano ofertę ${lastMutation.itemName}. Przedmiot wrócił do plecaka lub kolejki nagród.` : `Cancelled ${lastMutation.itemName}. The item returned to your backpack or rewards queue.`;
    return locale === 'pl'
      ? `Kupiono ${lastMutation.quantity} × ${lastMutation.itemName}.${lastMutation.delivery === 'CLAIMS' ? ' Plecak był pełny — zakup trafił do kolejki nagród.' : ''}`
      : `Bought ${lastMutation.quantity} × ${lastMutation.itemName}.${lastMutation.delivery === 'CLAIMS' ? ' Your backpack was full, so the purchase went to the rewards queue.' : ''}`;
  };

  return (
    <Modal title={locale === 'pl' ? `Rynek — ${snapshot?.station.npcName ?? npcName}` : `Market — ${snapshot?.station.npcName ?? npcName}`} subtitle={locale === 'pl' ? 'Kupuj i sprzedawaj przedmioty innym graczom z tego samego świata.' : 'Buy and sell items with players from the same realm.'} icon="⚖" onClose={onClose} widthClass="max-w-7xl">
      {!snapshot ? <p className="py-12 text-center text-sm text-slate-400">{locale === 'pl' ? 'Otwieranie rynku…' : 'Opening the market…'}</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-400/20 bg-black/25 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {(['BROWSE', 'MINE', 'SELL'] as MarketView[]).map((entry) => (
                <button key={entry} type="button" className={`hud-utility-button ${view === entry ? 'ring-1 ring-amber-300/70' : ''}`} onClick={() => { setView(entry); setLastMutation(undefined); }}>
                  {entry === 'BROWSE' ? (locale === 'pl' ? 'Przeglądaj' : 'Browse') : entry === 'MINE' ? (locale === 'pl' ? 'Moje oferty' : 'My listings') : (locale === 'pl' ? 'Sprzedaj' : 'Sell')}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{locale === 'pl' ? 'Srebro' : 'Silver'}: <strong className="text-amber-200">{snapshot.silver}</strong></span>
              <span>{locale === 'pl' ? 'Aktywne oferty' : 'Active listings'}: {snapshot.rules.activeListingCount}/{snapshot.rules.activeListingLimit}</span>
              <button type="button" className="hud-utility-button" disabled={busy} onClick={() => void refresh()}>{locale === 'pl' ? 'Odśwież' : 'Refresh'}</button>
            </div>
          </div>

          {mutationMessage() ? <div className="rounded border border-emerald-400/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100" role="status">{mutationMessage()}</div> : null}

          {view === 'SELL' ? (
            <SellPanel snapshot={snapshot} locale={locale} busy={busy} onList={(itemId, quantity, price) => void mutate(() => connection.listMarketItem(itemId, quantity, price))} />
          ) : (
            <div className="space-y-4">
              {view === 'BROWSE' ? (
                <div className="grid gap-3 rounded border border-white/10 bg-black/20 p-3 md:grid-cols-4">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === 'pl' ? 'Szukaj przedmiotu lub sprzedawcy…' : 'Search item or seller…'} className="rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                  <select value={rarity} onChange={(event) => setRarity(event.target.value)} className="rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="ALL">{locale === 'pl' ? 'Wszystkie rzadkości' : 'All rarities'}</option><option value="COMMON">COMMON</option><option value="ARTIFACT">ARTIFACT</option><option value="MYTHIC">MYTHIC</option></select>
                  <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="ALL">{locale === 'pl' ? 'Wszystkie kategorie' : 'All categories'}</option><option value="EQUIPMENT">EQUIPMENT</option><option value="MATERIAL">MATERIAL</option><option value="CONSUMABLE">CONSUMABLE</option></select>
                  <select value={sort} onChange={(event) => setSort(event.target.value as MarketSort)} className="rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="PRICE_ASC">{locale === 'pl' ? 'Cena rosnąco' : 'Price ascending'}</option><option value="PRICE_DESC">{locale === 'pl' ? 'Cena malejąco' : 'Price descending'}</option><option value="NEWEST">{locale === 'pl' ? 'Najnowsze' : 'Newest'}</option><option value="EXPIRING">{locale === 'pl' ? 'Wygasające' : 'Expiring soon'}</option></select>
                </div>
              ) : null}
              {(view === 'BROWSE' ? visibleListings : snapshot.mine).length === 0 ? <p className="rounded border border-white/10 bg-black/20 py-12 text-center text-sm text-slate-400">{view === 'BROWSE' ? (locale === 'pl' ? 'Brak ofert spełniających filtry.' : 'No listings match the filters.') : (locale === 'pl' ? 'Nie masz jeszcze ofert.' : 'You have no listings yet.')}</p> : null}
              <div className="grid gap-4 xl:grid-cols-2">
                {(view === 'BROWSE' ? visibleListings : snapshot.mine).map((listing) => <ListingCard key={listing.id} listing={listing} locale={locale} busy={busy} mode={view} onBuy={(listingId) => void mutate(() => connection.buyMarketListing(listingId))} onCancel={(listingId) => void mutate(() => connection.cancelMarketListing(listingId))} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
