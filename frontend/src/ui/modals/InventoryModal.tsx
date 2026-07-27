import { useEffect, useMemo, useState } from 'react';
import type { EquipmentSlot, InventoryItemPayload, InventorySnapshot, MerchantSnapshot } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const equipmentSlots: EquipmentSlot[] = ['HEAD', 'AMULET', 'MAIN_HAND', 'CHEST', 'RING', 'OFF_HAND', 'LEGS', 'FEET'];
const slotLabels: Record<EquipmentSlot, { en: string; pl: string }> = {
  HEAD: { en: 'Head', pl: 'Głowa' }, CHEST: { en: 'Chest', pl: 'Napierśnik' }, LEGS: { en: 'Legs', pl: 'Nogi' }, FEET: { en: 'Feet', pl: 'Buty' },
  MAIN_HAND: { en: 'Main hand', pl: 'Główna ręka' }, OFF_HAND: { en: 'Off hand', pl: 'Druga ręka' }, AMULET: { en: 'Amulet', pl: 'Amulet' }, RING: { en: 'Ring', pl: 'Pierścień' },
};
const localizedNames: Record<string, string> = {
  'traveler-sword': 'Miecz podróżnika', 'apprentice-staff': 'Kostur adepta', 'field-bow': 'Łuk polowy',
  'minor-health-potion': 'Mała mikstura zdrowia', 'field-rations': 'Prowiant polowy', 'town-scroll': 'Zwój miejski',
};

type Tab = 'inventory' | 'merchant';

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const connection = useGameConnection();
  const [inventory, setInventory] = useState<InventorySnapshot>();
  const [merchant, setMerchant] = useState<MerchantSnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState<Tab>('inventory');
  const [busy, setBusy] = useState(false);
  const selected = inventory?.items.find((item) => item.id === selectedId);
  const slots = useMemo(() => Array.from({ length: inventory?.capacity ?? 40 }, (_, index) => inventory?.items.find((item) => item.slotIndex === index)), [inventory]);

  useEffect(() => {
    let mounted = true;
    void connection.getInventory().then((snapshot) => { if (mounted) setInventory(snapshot); });
    return () => { mounted = false; };
  }, [connection]);

  const mutateInventory = async (operation: () => Promise<InventorySnapshot>) => {
    if (busy) return;
    setBusy(true);
    try { setInventory(await operation()); } finally { setBusy(false); }
  };
  const mutateMerchant = async (operation: () => Promise<MerchantSnapshot>) => {
    if (busy) return;
    setBusy(true);
    try {
      const snapshot = await operation();
      setMerchant(snapshot);
      setInventory(snapshot.inventory);
    } finally { setBusy(false); }
  };
  const openMerchant = async () => {
    setTab('merchant');
    await mutateMerchant(() => connection.getMerchant());
  };
  const name = (item: { definitionKey: string; name: string }) => locale === 'pl' ? (localizedNames[item.definitionKey] ?? item.name) : item.name;

  return (
    <Modal title={t('modal.inventory.title')} subtitle={locale === 'pl' ? 'Ekwipunek i handel z pobliskim NPC' : 'Inventory and nearby NPC trading'} icon="▦" onClose={onClose} widthClass="max-w-6xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" className="hud-utility-button" disabled={busy} onClick={() => setTab('inventory')}>{locale === 'pl' ? 'Ekwipunek' : 'Inventory'}</button>
          <button type="button" className="hud-utility-button" disabled={busy} onClick={() => void openMerchant()}>{locale === 'pl' ? 'Handlarz NPC' : 'NPC merchant'}</button>
        </div>
        <strong className="text-amber-200">{inventory?.silver ?? 0} {locale === 'pl' ? 'srebra' : 'silver'}</strong>
      </div>

      {tab === 'merchant' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <section className="rounded border border-amber-400/20 bg-black/20 p-4">
            <h3 className="modal-section-title">{merchant?.merchant.name ?? (locale === 'pl' ? 'Handlarz' : 'Merchant')}</h3>
            <p className="mt-2 text-xs text-slate-400">{locale === 'pl' ? 'Kupno wymaga wolnego miejsca lub dostępnego stacka.' : 'Buying requires a free slot or available stack space.'}</p>
            <div className="mt-4 space-y-2">
              {merchant?.items.map((item) => (
                <div key={item.definitionKey} className="flex items-center justify-between gap-3 rounded border border-white/10 p-3">
                  <div className="flex items-center gap-3"><span className="text-2xl">{item.icon}</span><div><strong>{name(item)}</strong><p className="text-xs text-slate-400">{item.buyPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</p></div></div>
                  <button className="hud-utility-button" disabled={busy || (inventory?.silver ?? 0) < item.buyPriceSilver} onClick={() => void mutateMerchant(() => connection.buyFromMerchant(item.definitionKey, 1))}>{locale === 'pl' ? 'Kup 1' : 'Buy 1'}</button>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded border border-amber-400/20 bg-black/20 p-4">
            <h3 className="modal-section-title">{locale === 'pl' ? 'Sprzedaj przedmioty' : 'Sell items'}</h3>
            <div className="mt-4 space-y-2">
              {inventory?.items.filter((item) => item.sellable).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded border border-white/10 p-3">
                  <div className="flex items-center gap-3"><span className="text-2xl">{item.icon}</span><div><strong>{name(item)}</strong><p className="text-xs text-slate-400">{item.quantity} × {item.sellPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</p></div></div>
                  <button className="hud-utility-button" disabled={busy || Boolean(item.equippedSlot)} onClick={() => void mutateMerchant(() => connection.sellToMerchant(item.id, 1))}>{item.equippedSlot ? (locale === 'pl' ? 'Najpierw zdejmij' : 'Unequip first') : (locale === 'pl' ? 'Sprzedaj 1' : 'Sell 1')}</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[240px_1fr_260px]">
          <section>
            <h3 className="modal-section-title">{t('modal.inventory.equipment')}</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {equipmentSlots.map((slot) => {
                const item = inventory?.items.find((candidate) => candidate.equippedSlot === slot);
                return <button key={slot} type="button" disabled={!item} onClick={() => item && setSelectedId(item.id)} className="equipment-slot min-h-20"><span>{slotLabels[slot][locale]}</span>{item ? <strong className="mt-1 text-lg">{item.icon}</strong> : null}</button>;
              })}
            </div>
          </section>
          <section>
            <h3 className="modal-section-title">{t('modal.inventory.backpack')}</h3>
            <div className="mt-3 grid grid-cols-8 gap-1.5">
              {slots.map((item, index) => <button key={index} type="button" draggable={Boolean(item)} disabled={busy}
                onDragStart={(event) => item && event.dataTransfer.setData('text/item-id', item.id)} onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); const itemId = event.dataTransfer.getData('text/item-id'); if (itemId) void mutateInventory(() => connection.moveInventoryItem(itemId, index)); }}
                onClick={() => setSelectedId(item?.id)} className={`inventory-slot ${selectedId === item?.id ? 'ring-2 ring-amber-300' : ''}`}
                aria-label={item ? `${name(item)}, ${item.quantity}` : t('common.emptySlot')}>{item ? <><span className="text-xl">{item.icon}</span><small>{item.quantity}</small>{item.equippedSlot ? <i className="absolute left-1 top-1 text-[8px] text-emerald-300">E</i> : null}</> : null}</button>)}
            </div>
          </section>
          <section className="rounded border border-amber-400/20 bg-black/20 p-4">
            {selected ? <><div className="text-4xl">{selected.icon}</div><h3 className="mt-2 font-semibold text-amber-100">{name(selected)}</h3><p className="mt-2 text-xs text-slate-300">{selected.description}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{selected.category} · {selected.quantity}/{selected.stackLimit}</p>
              <p className="mt-2 text-xs text-amber-200">{locale === 'pl' ? 'Kupno' : 'Buy'}: {selected.buyPriceSilver} · {locale === 'pl' ? 'Sprzedaż' : 'Sell'}: {selected.sellPriceSilver}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {selected.usable ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutateInventory(() => connection.useInventoryItem(selected.id))}>{locale === 'pl' ? 'Użyj' : 'Use'}</button> : null}
                {selected.equipmentSlot && !selected.equippedSlot ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutateInventory(() => connection.equipInventoryItem(selected.id))}>{locale === 'pl' ? 'Załóż' : 'Equip'}</button> : null}
                {selected.equippedSlot ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutateInventory(() => connection.unequipInventoryItem(selected.id))}>{locale === 'pl' ? 'Zdejmij' : 'Unequip'}</button> : null}
                <button className="hud-utility-button" disabled={busy} onClick={() => void mutateInventory(() => connection.discardInventoryItem(selected.id, 1))}>{locale === 'pl' ? 'Wyrzuć 1' : 'Discard 1'}</button>
              </div></> : <p className="text-sm text-slate-400">{locale === 'pl' ? 'Wybierz przedmiot.' : 'Select an item.'}</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}
