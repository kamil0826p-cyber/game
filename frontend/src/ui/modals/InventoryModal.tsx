import { useEffect, useMemo, useState } from 'react';
import type { EquipmentSlot, InventoryItemPayload, InventorySnapshot } from '../../contracts/socket';
import { ItemIcon } from '../../components/common/ItemIcon';
import { ItemTooltip, rarityClasses } from '../../components/common/ItemTooltip';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const equipmentSlots: EquipmentSlot[] = ['HEAD', 'AMULET', 'MAIN_HAND', 'CHEST', 'RING', 'OFF_HAND', 'LEGS', 'FEET'];
const slotLabels: Record<EquipmentSlot, { en: string; pl: string }> = {
  HEAD: { en: 'Head', pl: 'Głowa' }, CHEST: { en: 'Chest', pl: 'Napierśnik' }, LEGS: { en: 'Legs', pl: 'Nogi' }, FEET: { en: 'Feet', pl: 'Buty' },
  MAIN_HAND: { en: 'Main hand', pl: 'Główna ręka' }, OFF_HAND: { en: 'Off hand', pl: 'Druga ręka' }, AMULET: { en: 'Amulet', pl: 'Amulet' }, RING: { en: 'Ring', pl: 'Pierścień' },
};

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const connection = useGameConnection();
  const self = useGameState().self;
  const [inventory, setInventory] = useState<InventorySnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const selected = inventory?.items.find((item) => item.id === selectedId);
  const slots = useMemo(() => Array.from({ length: inventory?.capacity ?? 40 }, (_, index) => inventory?.items.find((item) => item.slotIndex === index)), [inventory]);
  const level = self?.level ?? 1;

  useEffect(() => {
    let mounted = true;
    void connection.getInventory().then((snapshot) => { if (mounted) setInventory(snapshot); }).catch(() => undefined);
    return () => { mounted = false; };
  }, [connection]);

  const mutate = async (operation: () => Promise<InventorySnapshot>) => {
    if (busy) return;
    setBusy(true);
    try { setInventory(await operation()); } catch { /* notification is emitted by the socket client */ } finally { setBusy(false); }
  };
  const tooltipItem = (item: InventoryItemPayload) => item;
  const canEquip = (item: InventoryItemPayload | undefined): boolean => Boolean(item?.equipmentSlot && item.minimumLevel <= level);
  const startDrag = (event: React.DragEvent, item: InventoryItemPayload) => event.dataTransfer.setData('text/item-id', item.id);
  const droppedItem = (event: React.DragEvent) => inventory?.items.find((item) => item.id === event.dataTransfer.getData('text/item-id'));
  const destroyInventoryItem = (itemId: string): Promise<InventorySnapshot> => connection.discardInventoryItem(itemId, 1);

  return (
    <Modal title={t('modal.inventory.title')} subtitle={locale === 'pl' ? 'Najedź po statystyki, kliknij po akcje.' : 'Hover for stats, click for actions.'} icon="▦" onClose={onClose} widthClass="max-w-4xl">
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <section>
          <h3 className="modal-section-title">{t('modal.inventory.equipment')}</h3>
          <p className="mt-2 text-xs text-slate-400">{locale === 'pl' ? 'Przeciągnij przedmiot z plecaka na właściwy slot.' : 'Drag an item from the backpack onto its matching slot.'}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {equipmentSlots.map((slot) => {
              const item = inventory?.items.find((candidate) => candidate.equippedSlot === slot);
              const button = <button
                key={slot}
                type="button"
                disabled={busy}
                draggable={Boolean(item)}
                onDragStart={(event) => item && startDrag(event, item)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = droppedItem(event);
                  if (dropped?.equipmentSlot === slot && canEquip(dropped)) void mutate(() => connection.equipInventoryItem(dropped.id));
                }}
                onClick={() => item && setSelectedId(item.id)}
                className={`equipment-slot min-h-20 ${item ? rarityClasses(item.rarity) : ''} ${selectedId === item?.id ? 'ring-2 ring-amber-300' : ''}`}
              ><span>{slotLabels[slot][locale]}</span>{item ? <ItemIcon definitionKey={item.definitionKey} fallback={item.icon} className="mt-1 h-9 w-9" /> : null}</button>;
              return item ? <ItemTooltip key={slot} item={tooltipItem(item)} currentLevel={level}>{button}</ItemTooltip> : button;
            })}
          </div>
        </section>
        <section>
          <h3 className="modal-section-title">{t('modal.inventory.backpack')}</h3>
          <div className="mt-3 grid grid-cols-8 gap-1.5 pb-2">
            {slots.map((item, index) => {
              const locked = Boolean(item?.equipmentSlot && item.minimumLevel > level);
              const button = <button key={index} type="button" draggable={Boolean(item)} disabled={busy}
                onDragStart={(event) => item && startDrag(event, item)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); const dropped = droppedItem(event); if (dropped) void mutate(async () => { if (dropped.equippedSlot) await connection.unequipInventoryItem(dropped.id); return connection.moveInventoryItem(dropped.id, index); }); }}
                onClick={() => setSelectedId(item?.id)} className={`inventory-slot ${item ? rarityClasses(item.rarity) : ''} ${selectedId === item?.id ? 'ring-2 ring-amber-300' : ''} ${locked ? 'opacity-60' : ''}`}
                aria-label={item ? `${item.name}, ${item.quantity}` : t('common.emptySlot')}>{item ? <><ItemIcon definitionKey={item.definitionKey} fallback={item.icon} className="h-8 w-8" /><small>{item.quantity}</small>{item.equippedSlot ? <i className="absolute left-1 top-1 text-[8px] text-emerald-300">E</i> : null}{locked ? <i className="absolute right-1 top-1 text-[8px] font-bold text-red-300">Lv</i> : null}</> : null}</button>;
              return item ? <ItemTooltip key={index} item={tooltipItem(item)} currentLevel={level}>{button}</ItemTooltip> : button;
            })}
          </div>
        </section>
      </div>
      <section className={`sticky -bottom-5 z-20 -mx-5 -mb-5 mt-5 min-h-[76px] border-t bg-slate-950/[0.98] px-5 py-3 shadow-[0_-12px_24px_rgba(2,6,23,0.75)] ${selected ? rarityClasses(selected.rarity) : 'border-white/10'}`}>
        {selected ? <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><ItemIcon definitionKey={selected.definitionKey} fallback={selected.icon} className="h-10 w-10" /><div><strong className="block">{selected.name}</strong><span className={`text-[11px] ${selected.minimumLevel > level ? 'text-red-300' : 'text-slate-400'}`}>{selected.minimumLevel > level ? `${locale === 'pl' ? 'Wymagany poziom' : 'Required level'}: ${selected.minimumLevel}` : locale === 'pl' ? 'Dostępne akcje' : 'Available actions'}</span></div></div>
          <div className="flex flex-wrap gap-2">
            {selected.usable ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutate(() => connection.useInventoryItem(selected.id))}>{locale === 'pl' ? 'Użyj' : 'Use'}</button> : null}
            {selected.equipmentSlot && !selected.equippedSlot ? <button className="hud-utility-button" disabled={busy || !canEquip(selected)} onClick={() => void mutate(() => connection.equipInventoryItem(selected.id))}>{selected.minimumLevel > level ? `${locale === 'pl' ? 'Wymaga Lv.' : 'Requires Lv.'} ${selected.minimumLevel}` : locale === 'pl' ? 'Załóż' : 'Equip'}</button> : null}
            {selected.equippedSlot ? <button className="hud-utility-button" disabled={busy} onClick={() => void mutate(() => connection.unequipInventoryItem(selected.id))}>{locale === 'pl' ? 'Zdejmij' : 'Unequip'}</button> : null}
            <button className="hud-utility-button" disabled={busy || Boolean(selected.equippedSlot)} onClick={() => void mutate(() => destroyInventoryItem(selected.id))}>{locale === 'pl' ? 'Zniszcz 1' : 'Destroy 1'}</button>
          </div>
        </div> : <p className="py-3 text-center text-sm text-slate-400">{locale === 'pl' ? 'Kliknij przedmiot, aby wyświetlić przyciski akcji.' : 'Click an item to show action buttons.'}</p>}
      </section>
    </Modal>
  );
}
