import { useState, type MouseEvent, type PropsWithChildren } from 'react';
import type { CharacterClass } from '../../contracts/game';
import type { ItemRarity, ItemStatBonuses } from '../../contracts/socket';
import { useI18n } from '../../i18n/I18nProvider';

export interface TooltipItem {
  name: string;
  description: string;
  rarity: ItemRarity;
  icon: string;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  statBonuses: ItemStatBonuses;
  effect?: { hp?: number; energy?: number };
  quantity?: number;
  stackLimit?: number;
  buyPriceSilver?: number;
  sellPriceSilver?: number;
}

const rarityStyle: Record<ItemRarity, { border: string; name: string; label: { pl: string; en: string } }> = {
  COMMON: { border: 'border-slate-400/70', name: 'text-slate-200', label: { pl: 'Zwykły', en: 'Common' } },
  ARTIFACT: { border: 'border-sky-500/80', name: 'text-sky-300', label: { pl: 'Artefakt', en: 'Artifact' } },
  MYTHIC: { border: 'border-red-500/80', name: 'text-red-300', label: { pl: 'Mityczny', en: 'Mythic' } },
};

const statLabels: Record<keyof ItemStatBonuses, { pl: string; en: string }> = {
  strength: { pl: 'Siła', en: 'Strength' }, agility: { pl: 'Zręczność', en: 'Agility' }, intelligence: { pl: 'Inteligencja', en: 'Intelligence' }, armor: { pl: 'Pancerz', en: 'Armor' }, maxHp: { pl: 'Maks. zdrowie', en: 'Maximum health' }, maxEnergy: { pl: 'Maks. energia', en: 'Maximum energy' },
};
const classLabels: Record<CharacterClass, { pl: string; en: string }> = {
  WARRIOR: { pl: 'Wojownik', en: 'Warrior' }, MAGE: { pl: 'Mag', en: 'Mage' }, ARCHER: { pl: 'Łucznik', en: 'Archer' },
};

export const rarityClasses = (rarity: ItemRarity): string => rarity === 'ARTIFACT'
  ? 'border-sky-500/70 text-sky-300'
  : rarity === 'MYTHIC' ? 'border-red-500/70 text-red-300' : 'border-slate-500/60 text-slate-200';

export function ItemTooltip({ item, children }: PropsWithChildren<{ item: TooltipItem }>): React.JSX.Element {
  const { locale } = useI18n();
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const bonuses = (Object.entries(item.statBonuses) as Array<[keyof ItemStatBonuses, number]>).filter(([, value]) => value !== 0);
  const style = rarityStyle[item.rarity];
  const move = (event: MouseEvent<HTMLElement>) => setPosition({
    x: Math.max(12, Math.min(event.clientX + 16, window.innerWidth - 300)),
    y: Math.max(12, Math.min(event.clientY + 16, window.innerHeight - 312)),
  });

  return (
    <div className="contents" onMouseEnter={move} onMouseMove={move} onMouseLeave={() => setPosition(undefined)}>
      {children}
      {position ? (
        <div role="tooltip" className={`pointer-events-none fixed z-[80] w-72 rounded-md border ${style.border} bg-slate-950/[0.98] p-3 text-left shadow-2xl backdrop-blur-sm`} style={{ left: position.x, top: position.y }}>
          <div className="flex items-start gap-3"><span className="text-3xl">{item.icon}</span><div className="min-w-0"><strong className={`block truncate text-sm ${style.name}`}>{item.name}</strong><span className={`mt-0.5 block text-[10px] uppercase tracking-[0.18em] ${style.name}`}>{style.label[locale]}</span></div></div>
          <p className="mt-3 text-xs leading-relaxed text-slate-300">{item.description}</p>
          <div className="mt-3 space-y-1 border-t border-white/10 pt-2 text-xs">
            {item.requiredClass ? <p className="text-slate-300">{locale === 'pl' ? 'Klasa' : 'Class'}: {classLabels[item.requiredClass][locale]}</p> : null}
            {item.minimumLevel > 1 ? <p className="text-slate-300">{locale === 'pl' ? 'Poziom' : 'Level'}: {item.minimumLevel}</p> : null}
            {bonuses.map(([stat, value]) => <p key={stat} className="text-emerald-300">{statLabels[stat][locale]}: +{value}</p>)}
            {item.effect?.hp ? <p className="text-rose-300">{locale === 'pl' ? 'Przywraca zdrowie' : 'Restores health'}: {item.effect.hp}</p> : null}
            {item.effect?.energy ? <p className="text-sky-300">{locale === 'pl' ? 'Przywraca energię' : 'Restores energy'}: {item.effect.energy}</p> : null}
            {item.quantity !== undefined && item.stackLimit !== undefined ? <p className="text-slate-400">{locale === 'pl' ? 'Ilość' : 'Quantity'}: {item.quantity}/{item.stackLimit}</p> : null}
            {item.buyPriceSilver !== undefined ? <p className="text-amber-200">{locale === 'pl' ? 'Kupno' : 'Buy'}: {item.buyPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</p> : null}
            {item.sellPriceSilver !== undefined ? <p className="text-amber-200">{locale === 'pl' ? 'Sprzedaż' : 'Sell'}: {item.sellPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
