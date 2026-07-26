import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { MOCK_INVENTORY_ITEMS } from '../../mock/mockData';
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

interface InventoryTooltipState {
  id: string;
  label: string;
  quantity?: number;
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

const TOOLTIP_EDGE_PADDING = 140;

export function InventoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<InventoryTooltipState>();
  const slots = Array.from({ length: 40 }, (_, index) => MOCK_INVENTORY_ITEMS[index]);

  useEffect(() => {
    if (!tooltip) return;

    const hideTooltip = () => setTooltip(undefined);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    return () => {
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('scroll', hideTooltip, true);
    };
  }, [tooltip]);

  const showTooltip = (
    anchor: HTMLElement,
    index: number,
    label: string,
    quantity?: number,
  ): void => {
    const bounds = anchor.getBoundingClientRect();
    const placement = bounds.top >= 72 ? 'top' : 'bottom';
    const minimumLeft = Math.min(TOOLTIP_EDGE_PADDING, window.innerWidth / 2);
    const maximumLeft = Math.max(minimumLeft, window.innerWidth - TOOLTIP_EDGE_PADDING);

    setTooltip({
      id: `inventory-tooltip-${index}`,
      label,
      quantity,
      left: Math.max(minimumLeft, Math.min(maximumLeft, bounds.left + bounds.width / 2)),
      top: placement === 'top' ? bounds.top : bounds.bottom,
      placement,
    });
  };

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
            {slots.map((item, index) => {
              const label = item ? t(itemNameKey[item.name]) : t('common.emptySlot');
              const tooltipId = `inventory-tooltip-${index}`;

              return (
                <button
                  key={index}
                  type="button"
                  className="inventory-slot"
                  aria-label={item ? `${label}, ${item.quantity}` : label}
                  aria-describedby={tooltip?.id === tooltipId ? tooltipId : undefined}
                  onPointerEnter={(event) => showTooltip(event.currentTarget, index, label, item?.quantity)}
                  onPointerLeave={() => setTooltip(undefined)}
                  onFocus={(event) => showTooltip(event.currentTarget, index, label, item?.quantity)}
                  onBlur={() => setTooltip(undefined)}
                >
                  {item ? <><span className="text-xl">{item.icon}</span><small>{item.quantity}</small></> : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <p className="mock-banner mt-5">{t('modal.inventory.banner')}</p>
      {tooltip ? createPortal(
        <span
          id={tooltip.id}
          className="hud-tooltip-bubble"
          role="tooltip"
          style={{
            position: 'fixed',
            left: tooltip.left,
            top: tooltip.top,
            opacity: 1,
            visibility: 'visible',
            transform: tooltip.placement === 'top'
              ? 'translate(-50%, calc(-100% - 10px))'
              : 'translate(-50%, 10px)',
          }}
        >
          <span>{tooltip.label}</span>
          {tooltip.quantity !== undefined ? <kbd>×{tooltip.quantity}</kbd> : null}
        </span>,
        document.body,
      ) : null}
    </Modal>
  );
}
