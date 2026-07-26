import { MOCK_INVENTORY_ITEMS } from '../../mock/mockData';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const equipmentSlots = [
  'modal.inventory.slot.head',
  'modal.inventory.slot.amulet',
  'modal.inventory.slot.mainHand',
  'modal.inventory.slot.chest',
  'modal.inventory.slot.ring',
  'modal.inventory.slot.offHand',
  'modal.inventory.slot.gloves',
  'modal.inventory.slot.boots',
  'modal.inventory.slot.cape',
] as const;

const itemNameKey = {
  'Traveler Sword': 'modal.inventory.item.travelerSword',
  'Minor Health Potion': 'modal.inventory.item.minorHealthPotion',
  'Cave Crystal': 'modal.inventory.item.caveCrystal',
  'Town Scroll': 'modal.inventory.item.townScroll',
  'Field Rations': 'modal.inventory.item.fieldRations',
} as const;

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const slots = Array.from({ length: 40 }, (_, index) => MOCK_INVENTORY_ITEMS[index]);
  return (
    <Modal title={t('modal.inventory.title')} subtitle={t('modal.inventory.subtitle')} icon="▦" onClose={onClose} widthClass="max-w-4xl">
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <section>
          <h3 className="modal-section-title">{t('modal.inventory.equipment')}</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {equipmentSlots.map((slotKey) => (
              <div key={slotKey} className="equipment-slot"><span>{t(slotKey)}</span></div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="modal-section-title">{t('modal.inventory.backpack')}</h3>
          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {slots.map((item, index) => (
              <button key={index} type="button" className="inventory-slot" title={item ? t(itemNameKey[item.name]) : t('common.emptySlot')}>
                {item ? <><span className="text-xl">{item.icon}</span><small>{item.quantity}</small></> : null}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="mock-banner mt-5">{t('modal.inventory.banner')}</p>
    </Modal>
  );
}
