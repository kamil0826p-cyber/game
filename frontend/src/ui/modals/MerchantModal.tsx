import { useEffect, useState } from 'react';
import type { CharacterClass } from '../../contracts/game';
import type { InventoryItemPayload, ItemStatBonuses, MerchantItemPayload, MerchantSnapshot } from '../../contracts/socket';
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

const fallbackDetails: Record<string, { requiredClass?: CharacterClass; minimumLevel: number; statBonuses: ItemStatBonuses; effect?: { hp?: number; energy?: number } }> = {
  'traveler-sword': { requiredClass: 'WARRIOR', minimumLevel: 1, statBonuses: { strength: 3 } },
  'apprentice-staff': { requiredClass: 'MAGE', minimumLevel: 1, statBonuses: { intelligence: 3, maxEnergy: 10 } },
  'field-bow': { requiredClass: 'ARCHER', minimumLevel: 1, statBonuses: { agility: 3 } },
  'minor-health-potion': { minimumLevel: 1, statBonuses: {}, effect: { hp: 35 } },
  'field-rations': { minimumLevel: 1, statBonuses: {}, effect: { energy: 30 } },
};

const statLabels: Record<keyof ItemStatBonuses, { pl: string; en: string }> = {
  strength: { pl: 'Siła', en: 'Strength' },
  agility: { pl: 'Zręczność', en: 'Agility' },
  intelligence: { pl: 'Inteligencja', en: 'Intelligence' },
  armor: { pl: 'Pancerz', en: 'Armor' },
  maxHp: { pl: 'Maks. zdrowie', en: 'Maximum health' },
  maxEnergy: { pl: 'Maks. energia', en: 'Maximum energy' },
};

const classLabels: Record<CharacterClass, { pl: string; en: string }> = {
  WARRIOR: { pl: 'Wojownik', en: 'Warrior' },
  MAGE: { pl: 'Mag', en: 'Mage' },
  ARCHER: { pl: 'Łucznik', en: 'Archer' },
};

export function MerchantModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<MerchantSnapshot>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void connection.getMerchant()
      .then((value) => { if (mounted) setSnapshot(value); })
      .catch(onClose);
    return () => { mounted = false; };
  }, [connection, onClose]);

  const mutate = async (operation: () => Promise<MerchantSnapshot>) => {
    if (busy) return;
    setBusy(true);
    try { setSnapshot(await operation()); } catch { /* socket client displays the authoritative error */ } finally { setBusy(false); }
  };
  const name = (item: { definitionKey: string; name: string }) => locale === 'pl' ? (localizedNames[item.definitionKey] ?? item.name) : item.name;
  const sellable = snapshot?.inventory.items.filter((item) => item.sellable) ?? [];

  const itemDetails = (item: MerchantItemPayload) => {
    const fallback = fallbackDetails[item.definitionKey] ?? { minimumLevel: 1, statBonuses: {} };
    return {
      requiredClass: item.requiredClass ?? fallback.requiredClass,
      minimumLevel: item.minimumLevel ?? fallback.minimumLevel,
      statBonuses: item.statBonuses ?? fallback.statBonuses,
      effect: item.effect ?? fallback.effect,
    };
  };

  const renderDetails = (item: MerchantItemPayload) => {
    const details = itemDetails(item);
    const bonuses = (Object.entries(details.statBonuses) as Array<[keyof ItemStatBonuses, number]>).filter(([, value]) => value !== 0);
    return (
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {details.requiredClass ? <span className="text-slate-400">{locale === 'pl' ? 'Klasa' : 'Class'}: {classLabels[details.requiredClass][locale]}</span> : null}
        {details.minimumLevel > 1 ? <span className="text-slate-400">{locale === 'pl' ? 'Poziom' : 'Level'}: {details.minimumLevel}</span> : null}
        {bonuses.map(([stat, value]) => <span key={stat} className="text-emerald-300">{statLabels[stat][locale]} +{value}</span>)}
        {details.effect?.hp ? <span className="text-rose-300">{locale === 'pl' ? 'Przywraca zdrowie' : 'Restores health'}: {details.effect.hp}</span> : null}
        {details.effect?.energy ? <span className="text-sky-300">{locale === 'pl' ? 'Przywraca energię' : 'Restores energy'}: {details.effect.energy}</span> : null}
      </div>
    );
  };

  return (
    <Modal
      title="Borin Żelazna Dłoń"
      subtitle={locale === 'pl' ? 'Handlarz uzbrojeniem i zaopatrzeniem' : 'Weapons and supplies merchant'}
      icon="⚒"
      onClose={onClose}
      widthClass="max-w-5xl"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded border border-amber-400/20 bg-black/20 p-4">
          <h3 className="modal-section-title">{locale === 'pl' ? 'Kup' : 'Buy'}</h3>
          <div className="mt-4 space-y-2">
            {snapshot?.items.map((item) => (
              <div key={item.definitionKey} className="flex items-center justify-between gap-3 rounded border border-white/10 p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div className="min-w-0">
                    <strong className="block truncate text-amber-100">{name(item)}</strong>
                    {renderDetails(item)}
                    <p className="mt-1 text-xs text-amber-200">{item.buyPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</p>
                  </div>
                </div>
                <button type="button" className="hud-utility-button shrink-0" disabled={busy || (snapshot?.silver ?? 0) < item.buyPriceSilver} onClick={() => void mutate(() => connection.buyFromMerchant(item.definitionKey, 1))}>{locale === 'pl' ? 'Kup 1' : 'Buy 1'}</button>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded border border-amber-400/20 bg-black/20 p-4">
          <h3 className="modal-section-title">{locale === 'pl' ? 'Sprzedaj' : 'Sell'}</h3>
          <div className="mt-4 space-y-2">
            {sellable.length === 0 ? <p className="text-sm text-slate-400">{locale === 'pl' ? 'Nie masz przedmiotów, które można sprzedać.' : 'You have no sellable items.'}</p> : null}
            {sellable.map((item: InventoryItemPayload) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded border border-white/10 p-3">
                <div className="flex min-w-0 items-center gap-3"><span className="text-2xl">{item.icon}</span><div className="min-w-0"><strong className="block truncate text-amber-100">{name(item)}</strong><p className="text-xs text-slate-400">{item.quantity} × {item.sellPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</p></div></div>
                <button type="button" className="hud-utility-button shrink-0" disabled={busy || Boolean(item.equippedSlot)} onClick={() => void mutate(() => connection.sellToMerchant(item.id, 1))}>{item.equippedSlot ? (locale === 'pl' ? 'Najpierw zdejmij' : 'Unequip first') : (locale === 'pl' ? 'Sprzedaj 1' : 'Sell 1')}</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
