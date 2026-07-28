import { useEffect, useState } from 'react';
import type {
  InventoryItemPayload,
  MerchantItemPayload,
  MerchantSnapshot,
} from '../../contracts/socket';
import { ItemTooltip, rarityClasses } from '../../components/common/ItemTooltip';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const localizedNames: Record<string, string> = {
  'traveler-sword': 'Miecz podróżnika',
  'apprentice-staff': 'Kostur adepta',
  'field-bow': 'Łuk polowy',
  'minor-health-potion': 'Mała mikstura zdrowia',
  'field-rations': 'Prowiant polowy',
};

export function MerchantModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<MerchantSnapshot>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void connection
      .getMerchant()
      .then((value) => {
        if (mounted) setSnapshot(value);
      })
      .catch(onClose);
    return () => {
      mounted = false;
    };
  }, [connection, onClose]);

  const mutate = async (operation: () => Promise<MerchantSnapshot>) => {
    if (busy) return;
    setBusy(true);
    try {
      setSnapshot(await operation());
    } catch {
      /* socket client displays the authoritative error */
    } finally {
      setBusy(false);
    }
  };
  const name = (item: { definitionKey: string; name: string }) =>
    locale === 'pl' ? (localizedNames[item.definitionKey] ?? item.name) : item.name;
  const merchantTooltip = (item: MerchantItemPayload) => ({
    ...item,
    name: name(item),
    buyPriceSilver: item.buyPriceSilver,
  });
  const inventoryTooltip = ({ buyPriceSilver: _, ...item }: InventoryItemPayload) => ({
    ...item,
    name: name(item),
    sellPriceSilver: item.sellPriceSilver,
  });
  const sellable = snapshot?.inventory.items.filter((item) => item.sellable) ?? [];

  return (
    <Modal
      title="Borin Żelazna Dłoń"
      subtitle={
        locale === 'pl'
          ? 'Najedź na przedmiot, aby zobaczyć jego statystyki.'
          : 'Hover an item to view its stats.'
      }
      icon="⚒"
      onClose={onClose}
      widthClass="max-w-5xl"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded border border-amber-400/20 bg-black/20 p-4">
          <h3 className="modal-section-title">{locale === 'pl' ? 'Kup' : 'Buy'}</h3>
          <div className="mt-4 space-y-2">
            {snapshot?.items.map((item) => (
              <ItemTooltip key={item.definitionKey} item={merchantTooltip(item)}>
                <div
                  className={`flex items-center justify-between gap-3 rounded border bg-black/20 p-3 ${rarityClasses(item.rarity)}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-2xl">{item.icon}</span>
                    <div className="min-w-0">
                      <strong className="block truncate">{name(item)}</strong>
                      <p className="text-xs text-amber-200">
                        {item.buyPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="hud-utility-button shrink-0"
                    disabled={busy || (snapshot?.silver ?? 0) < item.buyPriceSilver}
                    onClick={() =>
                      void mutate(() => connection.buyFromMerchant(item.definitionKey, 1))
                    }
                  >
                    {locale === 'pl' ? 'Kup 1' : 'Buy 1'}
                  </button>
                </div>
              </ItemTooltip>
            ))}
          </div>
        </section>
        <section className="rounded border border-amber-400/20 bg-black/20 p-4">
          <h3 className="modal-section-title">{locale === 'pl' ? 'Sprzedaj' : 'Sell'}</h3>
          <div className="mt-4 space-y-2">
            {sellable.length === 0 ? (
              <p className="text-sm text-slate-400">
                {locale === 'pl'
                  ? 'Nie masz przedmiotów, które można sprzedać.'
                  : 'You have no sellable items.'}
              </p>
            ) : null}
            {sellable.map((item) => (
              <ItemTooltip key={item.id} item={inventoryTooltip(item)}>
                <div
                  className={`flex items-center justify-between gap-3 rounded border bg-black/20 p-3 ${rarityClasses(item.rarity)}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-2xl">{item.icon}</span>
                    <div className="min-w-0">
                      <strong className="block truncate">{name(item)}</strong>
                      <p className="text-xs text-slate-400">
                        {item.quantity} × {item.sellPriceSilver}{' '}
                        {locale === 'pl' ? 'srebra' : 'silver'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="hud-utility-button shrink-0"
                    disabled={busy || Boolean(item.equippedSlot)}
                    onClick={() => void mutate(() => connection.sellToMerchant(item.id, 1))}
                  >
                    {item.equippedSlot
                      ? locale === 'pl'
                        ? 'Najpierw zdejmij'
                        : 'Unequip first'
                      : locale === 'pl'
                        ? 'Sprzedaj 1'
                        : 'Sell 1'}
                  </button>
                </div>
              </ItemTooltip>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
