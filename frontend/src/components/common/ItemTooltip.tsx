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

export const rarityClasses = (rarity: ItemRarity): string => {
  if (rarity === 'ARTIFACT') return 'border-sky-500/70 text-sky-300';
  if (rarity === 'MYTHIC') return 'border-red-500/70 text-red-300';
  return 'border-slate-500/60 text-slate-200';
};

export function ItemTooltip({ item, children }: PropsWithChildren<{ item: TooltipItem }>): React.JSX.Element {
  const { locale } = useI18n();
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const bonuses = (Object.entries(item.statBonuses) as Array<[keyof ItemStatBonuses, number]>).filter(([, value]) => value !== 0);
  const style = rarityStyle[item.rarity];

  const move = (event: MouseEvent<HTMLElement>) => {
    const width = 288;
    const height = 300;
    setPosition({
      x: Math.min(event.clientX + 16, window.innerWidth - width - 12),
      y: Math.min(event.clientY + 16, window.innerHeight - height - 12),
    });
  };

  return (
    <span className="contents" onMouseEnter={move} onMouseMove={move} onMouseLeave={() => setPosition(undefined)}>
      {children}
      {position ? (
        <span
          role="tooltip"
          className={`pointer-events-none fixed z-[80] w-72 rounded-md border ${style.border} bg-slate-950/98 p-3 text-left shadow-2xl backdrop-blur-sm`}
          style={{ left: position.x, top: position.y }}
        >
          <span className="flex items-start gap-3">
            <span className="text-3xl">{item.icon}</span>
            <span className="min-w-0">
              <strong className={`block truncate text-sm ${style.name}`}>{item.name}</strong>
              <span className={`mt-0.5 block text-[10px] uppercase tracking-[0.18em] ${style.name}`}>{style.label[locale]}</span>
            </span>
          </span>
          <span className="mt-3 block text-xs leading-relaxed text-slate-300">{item.description}</span>
          <span className="mt-3 block space-y-1 border-t border-white/10 pt-2 text-xs">
            {item.requiredClass ? <span className="block text-slate-300">{locale === 'pl' ? 'Klasa' : 'Class'}: {classLabels[item.requiredClass][locale]}</span> : null}
            {item.minimumLevel > 1 ? <span className="block text-slate-300">{locale === 'pl' ? 'Poziom' : 'Level'}: {item.minimumLevel}</span> : null}
            {bonuses.map(([stat, value]) => <span key={stat} className="block text-emerald-300">{statLabels[stat][locale]}: +{value}</span>)}
            {item.effect?.hp ? <span className="block text-rose-300">{locale === 'pl' ? 'Przywraca zdrowie' : 'Restores health'}: {item.effect.hp}</span> : null}
            {item.effect?.energy ? <span className="block text-sky-300">{locale === 'pl' ? 'Przywraca energię' : 'Restores energy'}: {item.effect.energy}</span> : null}
            {item.quantity !== undefined && item.stackLimit !== undefined ? <span className="block text-slate-400">{locale === 'pl' ? 'Ilość' : 'Quantity'}: {item.quantity}/{item.stackLimit}</span> : null}
            {item.buyPriceSilver !== undefined ? <span className="block text-amber-200">{locale === 'pl' ? 'Kupno' : 'Buy'}: {item.buyPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</span> : null}
            {item.sellPriceSilver !== undefined ? <span className="block text-amber-200">{locale === 'pl' ? 'Sprzedaż' : 'Sell'}: {item.sellPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}</span> : null}
          </span>
        </span>
      ) : null}
    </span>
  );
}
