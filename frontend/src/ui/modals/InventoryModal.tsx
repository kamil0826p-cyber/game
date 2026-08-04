import { useEffect, useMemo, useState } from 'react';
import equipmentMannequinUrl from '../../assets/ui/equipment-mannequin.svg';
import { ItemIcon } from '../../components/common/ItemIcon';
import { ItemTooltip, rarityClasses } from '../../components/common/ItemTooltip';
import type { EquipmentSlot, InventoryItemPayload, InventorySnapshot } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { EquipmentSlotGlyph } from './EquipmentSlotGlyph';
import { Modal } from './Modal';

const equipmentLayout: Array<{ slot: EquipmentSlot; className: string }> = [
  { slot: 'HEAD', className: 'equipment-slot--head' },
  { slot: 'AMULET', className: 'equipment-slot--amulet' },
  { slot: 'CHEST', className: 'equipment-slot--chest' },
  { slot: 'MAIN_HAND', className: 'equipment-slot--main-hand' },
  { slot: 'OFF_HAND', className: 'equipment-slot--off-hand' },
  { slot: 'RING', className: 'equipment-slot--ring' },
  { slot: 'LEGS', className: 'equipment-slot--legs' },
  { slot: 'FEET', className: 'equipment-slot--feet' },
];

const slotLabels: Record<EquipmentSlot, { en: string; pl: string }> = {
  HEAD: { en: 'Head', pl: 'Głowa' },
  CHEST: { en: 'Chest', pl: 'Napierśnik' },
  LEGS: { en: 'Legs', pl: 'Nogi' },
  FEET: { en: 'Feet', pl: 'Buty' },
  MAIN_HAND: { en: 'Main hand', pl: 'Główna ręka' },
  OFF_HAND: { en: 'Off hand', pl: 'Druga ręka' },
  AMULET: { en: 'Amulet', pl: 'Amulet' },
  RING: { en: 'Ring', pl: 'Pierścień' },
};

const salvageMaterialLabels: Record<string, { en: string; pl: string }> = {
  'rabbit-fur': { en: 'Rabbit fur', pl: 'Królicze futro' },
  'rabbit-foot': { en: 'Rabbit foot', pl: 'Królicza łapka' },
  'scorpion-chitin': { en: 'Scorpion chitin', pl: 'Chityna skorpiona' },
  'scorpion-stinger': { en: 'Scorpion stinger', pl: 'Żądło skorpiona' },
  'venom-sac': { en: 'Venom sac', pl: 'Woreczek jadowy' },
};

const fallbackMaterialLabel = (itemKey: string): string =>
  itemKey
    .split('-')
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part,
    )
    .join(' ');

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const connection = useGameConnection();
  const self = useGameState().self;
  const [inventory, setInventory] = useState<InventorySnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [draggedItemId, setDraggedItemId] = useState<string>();
  const [dropTargetSlot, setDropTargetSlot] = useState<EquipmentSlot>();
  const [busy, setBusy] = useState(false);
  const selected = inventory?.items.find((item) => item.id === selectedId);
  const draggedItem = inventory?.items.find((item) => item.id === draggedItemId);
  const slots = useMemo(
    () =>
      Array.from({ length: inventory?.capacity ?? 40 }, (_, index) =>
        inventory?.items.find((item) => item.slotIndex === index),
      ),
    [inventory],
  );
  const level = self?.level ?? 1;
  const occupiedSlots = inventory?.items.filter((item) => item.slotIndex !== undefined).length ?? 0;

  useEffect(() => {
    let mounted = true;
    void connection
      .getInventory()
      .then((snapshot) => {
        if (mounted) setInventory(snapshot);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [connection]);

  const mutate = async (operation: () => Promise<InventorySnapshot>) => {
    if (busy) return;
    setBusy(true);
    try {
      setInventory(await operation());
    } catch {
      // A localized notification is emitted by the socket client.
    } finally {
      setBusy(false);
    }
  };
  const tooltipItem = (item: InventoryItemPayload) => item;
  const canEquip = (item: InventoryItemPayload | undefined): boolean =>
    Boolean(item?.equipmentSlot && item.minimumLevel <= level);
  const canSalvage = (item: InventoryItemPayload | undefined): boolean =>
    Boolean(
      item &&
        item.itemization?.salvagePolicy === 'ALLOWED' &&
        item.itemization.salvage &&
        !item.equippedSlot &&
        item.quantity === 1,
    );
  const materialLabel = (itemKey: string): string =>
    salvageMaterialLabels[itemKey]?.[locale] ?? fallbackMaterialLabel(itemKey);
  const salvageRewardText = (item: InventoryItemPayload): string => {
    const salvage = item.itemization?.salvage;
    if (!salvage) {
      return locale === 'pl'
        ? 'Dokładny zwrot materiałów jest niedostępny.'
        : 'The exact material return is unavailable.';
    }
    const guaranteed = salvage.deterministic
      .map((output) => `• ${output.quantity} × ${materialLabel(output.itemKey)}`)
      .join('\n');
    const rare = salvage.rare;
    const rareText = rare
      ? locale === 'pl'
        ? `\n\nMożliwy rzadki odzysk:\n• 1 × ${materialLabel(rare.itemKey)} — ${Math.round(
            rare.chance * 100,
          )}% szansy; gwarancja po ${rare.guaranteedAfterMisses} nieudanych próbach.`
        : `\n\nPossible rare recovery:\n• 1 × ${materialLabel(rare.itemKey)} — ${Math.round(
            rare.chance * 100,
          )}% chance; guaranteed after ${rare.guaranteedAfterMisses} failed attempts.`
      : '';
    return locale === 'pl'
      ? `Gwarantowany odzysk:\n${guaranteed}${rareText}`
      : `Guaranteed recovery:\n${guaranteed}${rareText}`;
  };
  const startDrag = (event: React.DragEvent, item: InventoryItemPayload): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/item-id', item.id);
    setDraggedItemId(item.id);
  };
  const finishDrag = (): void => {
    setDraggedItemId(undefined);
    setDropTargetSlot(undefined);
  };
  const droppedItem = (event: React.DragEvent) =>
    inventory?.items.find((item) => item.id === event.dataTransfer.getData('text/item-id'));
  const destroyInventoryItem = (itemId: string): Promise<InventorySnapshot> =>
    connection.destroyInventoryItem(itemId, 1);
  const confirmCurse = (item: InventoryItemPayload): boolean => {
    const curse = item.itemization?.curse;
    if (!item.itemization?.requiresEquipConfirmation || !curse) return true;
    return window.confirm(
      locale === 'pl'
        ? `Przeklęty przedmiot: ${curse.name}\n\n${curse.description}\n\n${curse.preview}\n\nKoszt jest aktywny przez cały czas, gdy przedmiot jest założony. Założyć przedmiot?`
        : `Cursed item: ${curse.name}\n\n${curse.description}\n\n${curse.preview}\n\nThe cost remains active while the item is equipped. Equip the item?`,
    );
  };
  const confirmSalvage = (item: InventoryItemPayload): boolean =>
    window.confirm(
      locale === 'pl'
        ? `Rozłożyć „${item.name}” na materiały?\n\n${salvageRewardText(
            item,
          )}\n\nPrzedmiot zostanie bezpowrotnie zniszczony. Tej operacji nie można cofnąć.`
        : `Salvage “${item.name}” into materials?\n\n${salvageRewardText(
            item,
          )}\n\nThe item will be permanently destroyed. This cannot be undone.`,
    );
  const confirmDestroy = (item: InventoryItemPayload): boolean =>
    window.confirm(
      locale === 'pl'
        ? `Zniszczyć 1 × „${item.name}”?\n\nNie otrzymasz żadnych materiałów. Tej operacji nie można cofnąć.`
        : `Destroy 1 × “${item.name}”?\n\nYou will not receive any materials. This cannot be undone.`,
    );
  const equipItem = (item: InventoryItemPayload): void => {
    if (!canEquip(item) || !confirmCurse(item)) return;
    const confirmationHash = item.itemization?.requiresEquipConfirmation
      ? item.itemization.equipConfirmationHash
      : undefined;
    void mutate(() => connection.equipInventoryItem(item.id, confirmationHash));
  };
  const salvageItem = (item: InventoryItemPayload): void => {
    if (!canSalvage(item) || !confirmSalvage(item)) return;
    void mutate(() => connection.salvageInventoryItem(item.id));
  };
  const destroyItem = (item: InventoryItemPayload): void => {
    if (item.equippedSlot || !confirmDestroy(item)) return;
    void mutate(() => destroyInventoryItem(item.id));
  };

  return (
    <Modal
      title={t('modal.inventory.title')}
      subtitle={
        locale === 'pl'
          ? 'Najedź po statystyki, przeciągnij aby zmienić wyposażenie.'
          : 'Hover for stats, drag to change equipment.'
      }
      icon="⛨"
      onClose={onClose}
      widthClass="max-w-[1120px]"
    >
      <div className="inventory-redesign">
        <div className="inventory-layout">
          <section className="inventory-equipment-panel" aria-labelledby="inventory-equipment-title">
            <header className="inventory-panel-heading">
              <div>
                <h3 id="inventory-equipment-title" className="modal-section-title">
                  {t('modal.inventory.equipment')}
                </h3>
                <p>
                  {locale === 'pl'
                    ? 'Sylwetka pokazuje aktualnie założony ekwipunek.'
                    : 'The paper doll shows your currently equipped items.'}
                </p>
              </div>
            </header>

            <div className="equipment-paperdoll">
              <img
                aria-hidden="true"
                alt=""
                className="equipment-mannequin"
                draggable={false}
                src={equipmentMannequinUrl}
              />

              {equipmentLayout.map(({ slot, className }) => {
                const item = inventory?.items.find((candidate) => candidate.equippedSlot === slot);
                const label = slotLabels[slot][locale];
                const acceptsDraggedItem = Boolean(
                  draggedItem && draggedItem.equipmentSlot === slot && draggedItem.minimumLevel <= level,
                );
                const button = (
                  <button
                    key={slot}
                    type="button"
                    title={label}
                    aria-label={
                      item
                        ? `${label}: ${item.name}`
                        : locale === 'pl'
                          ? `${label}: pusty slot`
                          : `${label}: empty slot`
                    }
                    disabled={busy}
                    draggable={Boolean(item)}
                    onDragStart={(event) => item && startDrag(event, item)}
                    onDragEnd={finishDrag}
                    onDragEnter={() => acceptsDraggedItem && setDropTargetSlot(slot)}
                    onDragLeave={() => dropTargetSlot === slot && setDropTargetSlot(undefined)}
                    onDragOver={(event) => {
                      if (!acceptsDraggedItem) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const dropped = droppedItem(event);
                      finishDrag();
                      if (dropped?.equipmentSlot === slot) equipItem(dropped);
                    }}
                    onClick={() => item && setSelectedId(item.id)}
                    className={`equipment-slot ${className} ${item ? rarityClasses(item.rarity) : ''} ${
                      selectedId === item?.id ? 'equipment-slot-selected' : ''
                    } ${dropTargetSlot === slot && acceptsDraggedItem ? 'equipment-slot-drop-ready' : ''} ${
                      draggedItemId === item?.id ? 'equipment-slot-dragging' : ''
                    }`}
                  >
                    <span className="equipment-slot-visual">
                      {item ? (
                        <ItemIcon
                          definitionKey={item.definitionKey}
                          fallback={item.icon}
                          className="h-10 w-10"
                        />
                      ) : (
                        <EquipmentSlotGlyph slot={slot} />
                      )}
                    </span>
                  </button>
                );
                return item ? (
                  <ItemTooltip key={slot} item={tooltipItem(item)} currentLevel={level}>
                    {button}
                  </ItemTooltip>
                ) : (
                  button
                );
              })}
            </div>

            <p className="equipment-hint">
              {locale === 'pl'
                ? 'Przeciągnij przedmiot z plecaka na pasujący symbol. Założony przedmiot możesz przeciągnąć z powrotem do plecaka.'
                : 'Drag an item from the backpack onto its matching symbol. Drag equipped items back into the backpack to unequip them.'}
            </p>
          </section>

          <section className="inventory-backpack-panel" aria-labelledby="inventory-backpack-title">
            <header className="inventory-panel-heading">
              <div>
                <h3 id="inventory-backpack-title" className="modal-section-title">
                  {t('modal.inventory.backpack')}
                </h3>
                <p>
                  {locale === 'pl'
                    ? 'Kliknij przedmiot, aby wyświetlić dostępne akcje.'
                    : 'Select an item to reveal the available actions.'}
                </p>
              </div>
              <span className="inventory-capacity">
                {occupiedSlots}/{inventory?.capacity ?? 40}
              </span>
            </header>

            <div className="inventory-grid-wrap">
              <div className="inventory-grid">
                {slots.map((item, index) => {
                  const locked = Boolean(item?.equipmentSlot && item.minimumLevel > level);
                  const button = (
                    <button
                      key={index}
                      type="button"
                      draggable={Boolean(item)}
                      disabled={busy}
                      onDragStart={(event) => item && startDrag(event, item)}
                      onDragEnd={finishDrag}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const dropped = droppedItem(event);
                        finishDrag();
                        if (!dropped) return;
                        void mutate(async () => {
                          if (dropped.equippedSlot) await connection.unequipInventoryItem(dropped.id);
                          return connection.moveInventoryItem(dropped.id, index);
                        });
                      }}
                      onClick={() => setSelectedId(item?.id)}
                      className={`inventory-slot ${item ? rarityClasses(item.rarity) : ''} ${
                        selectedId === item?.id ? 'ring-2 ring-amber-300' : ''
                      } ${locked ? 'opacity-60' : ''}`}
                      aria-label={item ? `${item.name}, ${item.quantity}` : t('common.emptySlot')}
                    >
                      {item ? (
                        <>
                          <ItemIcon
                            definitionKey={item.definitionKey}
                            fallback={item.icon}
                            className="h-9 w-9"
                          />
                          <small>{item.quantity}</small>
                          {item.equippedSlot ? (
                            <i className="inventory-equipped-mark" aria-hidden="true">
                              ◆
                            </i>
                          ) : null}
                          {locked ? (
                            <i className="inventory-level-lock" aria-hidden="true">
                              Lv
                            </i>
                          ) : null}
                        </>
                      ) : null}
                    </button>
                  );
                  return item ? (
                    <ItemTooltip key={index} item={tooltipItem(item)} currentLevel={level}>
                      {button}
                    </ItemTooltip>
                  ) : (
                    button
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        <section className={`inventory-action-bar ${selected ? rarityClasses(selected.rarity) : ''}`}>
          {selected ? (
            <div className="inventory-action-content">
              <div className="inventory-selected-item">
                <span className="inventory-selected-item-icon">
                  <ItemIcon
                    definitionKey={selected.definitionKey}
                    fallback={selected.icon}
                    className="h-10 w-10"
                  />
                </span>
                <div className="min-w-0">
                  <strong>{selected.name}</strong>
                  <span className={selected.minimumLevel > level ? 'text-red-300' : ''}>
                    {selected.minimumLevel > level
                      ? `${locale === 'pl' ? 'Wymagany poziom' : 'Required level'}: ${selected.minimumLevel}`
                      : locale === 'pl'
                        ? 'Dostępne akcje'
                        : 'Available actions'}
                  </span>
                </div>
              </div>
              <div className="inventory-action-buttons">
                {selected.usable ? (
                  <button
                    className="hud-utility-button"
                    disabled={busy}
                    onClick={() => void mutate(() => connection.useInventoryItem(selected.id))}
                  >
                    {locale === 'pl' ? 'Użyj' : 'Use'}
                  </button>
                ) : null}
                {selected.equipmentSlot && !selected.equippedSlot ? (
                  <button
                    className="hud-utility-button"
                    disabled={busy || !canEquip(selected)}
                    onClick={() => equipItem(selected)}
                  >
                    {selected.minimumLevel > level
                      ? `${locale === 'pl' ? 'Wymaga Lv.' : 'Requires Lv.'} ${selected.minimumLevel}`
                      : selected.itemization?.requiresEquipConfirmation
                        ? locale === 'pl'
                          ? 'Załóż przeklęty'
                          : 'Equip cursed'
                        : locale === 'pl'
                          ? 'Załóż'
                          : 'Equip'}
                  </button>
                ) : null}
                {selected.equippedSlot ? (
                  <button
                    className="hud-utility-button"
                    disabled={busy}
                    onClick={() => void mutate(() => connection.unequipInventoryItem(selected.id))}
                  >
                    {locale === 'pl' ? 'Zdejmij' : 'Unequip'}
                  </button>
                ) : null}
                {selected.itemization?.salvagePolicy === 'ALLOWED' ? (
                  <button
                    className="hud-utility-button"
                    disabled={busy || !canSalvage(selected)}
                    title={
                      selected.equippedSlot
                        ? locale === 'pl'
                          ? 'Najpierw zdejmij przedmiot.'
                          : 'Unequip the item first.'
                        : selected.quantity !== 1
                          ? locale === 'pl'
                            ? 'Rozkładać można wyłącznie pojedyncze przedmioty.'
                            : 'Only single-item stacks can be salvaged.'
                          : !selected.itemization.salvage
                            ? locale === 'pl'
                              ? 'Brak danych profilu odzysku.'
                              : 'Salvage profile data is unavailable.'
                            : undefined
                    }
                    onClick={() => salvageItem(selected)}
                  >
                    {locale === 'pl' ? 'Rozłóż na materiały' : 'Salvage'}
                  </button>
                ) : null}
                <button
                  className="hud-utility-button"
                  disabled={busy || Boolean(selected.equippedSlot)}
                  onClick={() => destroyItem(selected)}
                >
                  {locale === 'pl' ? 'Zniszcz 1' : 'Destroy 1'}
                </button>
              </div>
            </div>
          ) : (
            <p className="inventory-empty-selection">
              {locale === 'pl'
                ? 'Wybierz przedmiot z plecaka lub sylwetki.'
                : 'Select an item from the backpack or paper doll.'}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
