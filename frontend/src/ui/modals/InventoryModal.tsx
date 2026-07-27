import { useEffect, useMemo, useState } from 'react';
import type { EquipmentSlot, InventoryItemPayload, InventorySnapshot } from '../../contracts/socket';
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

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const connection = useGameConnection();
  const [inventory, setInventory] = useState<InventorySnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const selected = inventory?.items.find((item) => item.id === selectedId);
  const slots = useMemo(() => Array.from({ length: inventory?.capacity ?? 40 }, (_, index) => inventory?.items.find((item) => item.slotIndex === index)), [inventory]);

  useEffect(() => {
    let mounted = true;
    void connection.getInventory().then((snapshot) => { if (mounted) setInventory(snapshot); });
    return () => { mounted = false; };
  }, [connection]);

  const mutate = async (operation: () => Promise<InventorySnapshot>) => {
    if (busy) return;
    setBusy(true);
    try { setInventory(await operation()); } finally { setBusy(false); }
  };
  const name = (item: InventoryItemPayload) => locale === 'pl' ? (localizedNames[item.definitionKey] ?? item.name) : item.name;

  return (
    <Modal title={t('modal.inventory.title')} subtitle={locale === 'pl' ? 'Trwały ekwipunek zarządzany przez serwer' : 'Persistent server-authoritative inventory'} icon="▦" onClose={onClose} widthClass="max-w-5xl">
      <div className="grid gap-5 md:grid-cols-[240px_1fr_260px]">
        <section>
          <h3 className="modal-section-title">{t('modal.inventory.equipment')}</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {equipmentSlots.map((slot) => {
              const item = inventory?.items.find((candidate) => candidate.equippedSlot === slot);
              return <button key={slot} type="button" disabled={!item} onClick={() => item && setSelectedId(item.id)} className="equipment-slot min-h-20">
                <span>{slotLabels[slot][locale]}</span>{item ? <strong className="mt-1 text-lg">{item.icon}</strong> : null}
              </button>;
            })}
          </div>
        </section>
        <section>
          <h3 className="modal-section-title">{t('modal.inventory.backpack')}</h3>
          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {slots.map((item, index) => <button
              key={index} type="button" draggable={Boolean(item)} disabled={busy}
              onDragStart={(event) => item && event.dataTransfer.setData('text/item-id', item.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const itemId = event.dataTransfer.getData('text/item-id'); if (itemId) void mutate(() => connection.moveInventoryItem(itemId, index)); }}
              onClick={() => setSelectedId(item?.id)}
              className={`inventory-slot ${selectedId === item?.id ? 'ring-2 ring-amber-300' : ''}`}
              aria-label={item ? `${name(item)}, ${item.quantity}` : t('common.emptySlot')}
            >{item ? <><span className="text-xl">{item.icon}</span><small>{item.quantity}</small>{item.equippedSlot ? <i className="absolute left-1 top-1 text-[8px] text-emerald-300">E</i> : null}</> : null}</button>)}
          </div>
          <p className="mt-3 text-xs text-amber-100/60">{locale === 'pl' ? 'Przeciągnij przedmiot, aby zmienić slot lub połączyć stos.' : 'Drag an item to move, swap, or merge its stack.'}</p>
        </section>
        <section className="rounded border border-amber-400/20 bg-black/20 p-4">
          {selected ? <>
            <div className="text-4xl">{selected.icon}</div>
            <h3 className="mt-2 font-semibold text-amber-100">{name(selected)}</h3>
            <p className="mt-2 text-xs text-slate-300">{selected.description}</p>
            <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{selected.category} · {selected.quantity}/{selected.stackLimit}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.usable ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutate(() => connection.useInventoryItem(selected.id))}>{locale === 'pl' ? 'Użyj' : 'Use'}</button> : null}
              {selected.equipmentSlot && !selected.equippedSlot ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutate(() => connection.equipInventoryItem(selected.id))}>{locale === 'pl' ? 'Załóż' : 'Equip'}</button> : null}
              {selected.equippedSlot ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutate(() => connection.unequipInventoryItem(selected.id))}>{locale === 'pl' ? 'Zdejmij' : 'Unequip'}</button> : null}
              <button className="hud-utility-button" disabled={busy} onClick={() => void mutate(() => connection.discardInventoryItem(selected.id, 1))}>{locale === 'pl' ? 'Wyrzuć 1' : 'Discard 1'}</button>
            </div>
          </> : <p className="text-sm text-slate-400">{locale === 'pl' ? 'Wybierz przedmiot.' : 'Select an item.'}</p>}
        </section>
      </div>
    </Modal>
  );
}
