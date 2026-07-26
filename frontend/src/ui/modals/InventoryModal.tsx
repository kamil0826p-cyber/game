import { MOCK_INVENTORY_ITEMS } from '../../mock/mockData';
import { Modal } from './Modal';

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const slots = Array.from({ length: 40 }, (_, index) => MOCK_INVENTORY_ITEMS[index]);
  return (
    <Modal title="Inventory & Equipment" subtitle="Visual mock data only" icon="▦" onClose={onClose} widthClass="max-w-4xl">
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <section>
          <h3 className="modal-section-title">Equipment</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {['Head', 'Amulet', 'Main Hand', 'Chest', 'Ring', 'Off Hand', 'Gloves', 'Boots', 'Cape'].map((slot) => (
              <div key={slot} className="equipment-slot"><span>{slot}</span></div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="modal-section-title">Backpack</h3>
          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {slots.map((item, index) => (
              <button key={index} type="button" className="inventory-slot" title={item?.name ?? 'Empty slot'}>
                {item ? <><span className="text-xl">{item.icon}</span><small>{item.quantity}</small></> : null}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="mock-banner mt-5">Drag-and-drop, item use, persistence, and equipment effects are future systems.</p>
    </Modal>
  );
}
