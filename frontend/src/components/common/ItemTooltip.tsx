import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { CharacterClass } from '../../contracts/game';
import type {
  InventoryItemizationPayload,
  ItemCurseCost,
} from '../../contracts/itemization';
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
  itemization?: InventoryItemizationPayload;
}

interface HoverableProps {
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseMove?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
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

export const rarityClasses = (rarity: ItemRarity): string => rarity === 'ARTIFACT'
  ? 'border-sky-500/70 text-sky-300'
  : rarity === 'MYTHIC'
    ? 'border-red-500/70 text-red-300'
    : 'border-slate-500/60 text-slate-200';

const TOOLTIP_GAP = 14;
const VIEWPORT_PADDING = 10;

function placeTooltip(
  cursor: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  let x = cursor.x + TOOLTIP_GAP;
  let y = cursor.y + TOOLTIP_GAP;

  if (x + size.width > window.innerWidth - VIEWPORT_PADDING) {
    x = cursor.x - size.width - TOOLTIP_GAP;
  }
  if (y + size.height > window.innerHeight - VIEWPORT_PADDING) {
    y = cursor.y - size.height - TOOLTIP_GAP;
  }

  return {
    x: Math.max(
      VIEWPORT_PADDING,
      Math.min(x, window.innerWidth - size.width - VIEWPORT_PADDING),
    ),
    y: Math.max(
      VIEWPORT_PADDING,
      Math.min(y, window.innerHeight - size.height - VIEWPORT_PADDING),
    ),
  };
}

const policyLabel = (value: string): string => value
  .toLowerCase()
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const curseCostText = (
  cost: ItemCurseCost,
  locale: 'pl' | 'en',
): string => {
  switch (cost.type) {
    case 'STAT_PENALTY':
      return (Object.entries(cost.statBonuses) as Array<[keyof ItemStatBonuses, number]>)
        .map(([stat, value]) => `${statLabels[stat][locale]} ${value > 0 ? '+' : ''}${value}`)
        .join(', ');
    case 'HEALING_RECEIVED_MULTIPLIER':
      return locale === 'pl'
        ? `Otrzymywane leczenie ×${cost.multiplier}`
        : `Healing received ×${cost.multiplier}`;
    case 'CONSUMABLE_LOCK':
      return locale === 'pl'
        ? 'Leczące przedmioty użytkowe zablokowane'
        : 'Healing consumables disabled';
    case 'CORRUPTION_ON_TRIGGER':
      return locale === 'pl'
        ? `+${cost.amount} skażenia: ${policyLabel(cost.trigger)}`
        : `+${cost.amount} corruption: ${policyLabel(cost.trigger)}`;
  }
};

export function ItemTooltip({
  item,
  currentLevel,
  children,
}: {
  item: TooltipItem;
  currentLevel?: number;
  children: ReactElement<HoverableProps>;
}): React.JSX.Element {
  const { locale } = useI18n();
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>();
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const bonuses = (Object.entries(item.statBonuses) as Array<[keyof ItemStatBonuses, number]>)
    .filter(([, value]) => value !== 0);
  const style = rarityStyle[item.rarity];
  const levelTooLow = currentLevel !== undefined && currentLevel < item.minimumLevel;
  const itemization = item.itemization;

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!cursor || !tooltip) return;
    const bounds = tooltip.getBoundingClientRect();
    const next = placeTooltip(cursor, { width: bounds.width, height: bounds.height });
    setPosition((previous) =>
      previous?.x === next.x && previous.y === next.y ? previous : next,
    );
  }, [cursor, item, locale]);

  const move = (event: MouseEvent<HTMLElement>): void => {
    setCursor({ x: event.clientX, y: event.clientY });
  };
  const child = cloneElement(children, {
    onMouseEnter: (event) => {
      children.props.onMouseEnter?.(event);
      move(event);
    },
    onMouseMove: (event) => {
      children.props.onMouseMove?.(event);
      move(event);
    },
    onMouseLeave: (event) => {
      children.props.onMouseLeave?.(event);
      setCursor(undefined);
      setPosition(undefined);
    },
  });

  return (
    <>
      {child}
      {cursor ? createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`pointer-events-none z-[100] w-80 rounded-md border ${style.border} bg-slate-950/[0.98] p-3 text-left shadow-2xl backdrop-blur-sm`}
          style={{
            position: 'fixed',
            left: position?.x ?? cursor.x + TOOLTIP_GAP,
            top: position?.y ?? cursor.y + TOOLTIP_GAP,
          }}
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl">{item.icon}</span>
            <div className="min-w-0">
              <strong className={`block truncate text-sm ${style.name}`}>{item.name}</strong>
              <span className={`mt-0.5 block text-[10px] uppercase tracking-[0.18em] ${style.name}`}>
                {style.label[locale]}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-300">{item.description}</p>
          <div className="mt-3 space-y-1 border-t border-white/10 pt-2 text-xs">
            {item.requiredClass ? (
              <p className="text-slate-300">
                {locale === 'pl' ? 'Klasa' : 'Class'}: {classLabels[item.requiredClass][locale]}
              </p>
            ) : null}
            {item.minimumLevel > 1 ? (
              <p className={levelTooLow ? 'font-bold text-red-300' : 'text-slate-300'}>
                {locale === 'pl' ? 'Wymagany poziom' : 'Required level'}: {item.minimumLevel}
                {levelTooLow ? ` (${locale === 'pl' ? 'za niski' : 'too low'})` : ''}
              </p>
            ) : null}
            {bonuses.map(([stat, value]) => (
              <p key={stat} className={value >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                {statLabels[stat][locale]}: {value > 0 ? '+' : ''}{value}
              </p>
            ))}
            {item.effect?.hp ? (
              <p className="text-rose-300">
                {locale === 'pl' ? 'Przywraca zdrowie' : 'Restores health'}: {item.effect.hp}
              </p>
            ) : null}
            {item.effect?.energy ? (
              <p className="text-sky-300">
                {locale === 'pl' ? 'Przywraca energię' : 'Restores energy'}: {item.effect.energy}
              </p>
            ) : null}
          </div>

          {itemization ? (
            <div className="mt-3 space-y-2 border-t border-white/10 pt-2 text-xs text-slate-300">
              <p className="text-amber-100">
                {locale === 'pl' ? 'Moc' : 'Power'}: {itemization.powerSpent}/{itemization.powerBudget}
                {' · '}{locale === 'pl' ? 'poziom' : 'level'} {itemization.powerLevel}
                {itemization.craftQuality > 0 ? ` · ${locale === 'pl' ? 'jakość' : 'quality'} ${itemization.craftQuality}/100` : ''}
              </p>
              {itemization.affixes.map((affix) => (
                <div key={affix.key} className="rounded border border-white/10 bg-black/20 p-2">
                  <p className="text-violet-200">
                    {affix.kind === 'PREFIX'
                      ? locale === 'pl' ? 'Prefiks' : 'Prefix'
                      : locale === 'pl' ? 'Sufiks' : 'Suffix'} T{affix.tier}: {affix.name}
                  </p>
                  <p className="text-slate-400">
                    {locale === 'pl' ? 'Rzut' : 'Roll'} {affix.roll} ({affix.minimumRoll}–{affix.maximumRoll})
                  </p>
                </div>
              ))}
              {itemization.relic ? (
                <div className="rounded border border-amber-500/30 bg-amber-950/20 p-2">
                  <p className="font-semibold text-amber-200">
                    {locale === 'pl' ? 'Relikt' : 'Relic'}: {itemization.relic.name}
                  </p>
                  <p>{itemization.relic.description}</p>
                  <p className="text-slate-400">
                    {locale === 'pl' ? 'Aktywny po założeniu · umiejętność' : 'Active while equipped · skill'}: {itemization.relic.skillKey}
                  </p>
                </div>
              ) : null}
              {itemization.curse ? (
                <div className="rounded border border-red-500/40 bg-red-950/25 p-2">
                  <p className="font-semibold text-red-300">
                    {locale === 'pl' ? 'Klątwa' : 'Curse'}: {itemization.curse.name}
                  </p>
                  <p>{itemization.curse.description}</p>
                  <p className="mt-1 font-semibold text-red-200">{itemization.curse.preview}</p>
                  <p className="text-red-300">{curseCostText(itemization.curse.cost, locale)}</p>
                </div>
              ) : null}
              <div className="text-slate-400">
                <p>{locale === 'pl' ? 'Wiązanie' : 'Bind'}: {policyLabel(itemization.bindPolicy)}</p>
                <p>{locale === 'pl' ? 'Handel' : 'Trade'}: {policyLabel(itemization.tradePolicy)}</p>
                <p>Salvage: {policyLabel(itemization.salvagePolicy)}</p>
              </div>
              <div className="text-[11px] text-slate-500">
                <p>
                  {locale === 'pl' ? 'Pochodzenie' : 'Origin'}: {policyLabel(itemization.origin.source)} · {itemization.origin.sourceKey}
                </p>
                {itemization.origin.recipeKey ? (
                  <p>
                    {locale === 'pl' ? 'Receptura' : 'Recipe'}: {itemization.origin.recipeKey} v{itemization.origin.recipeVersion ?? 1}
                  </p>
                ) : null}
                {itemization.origin.crafterCharacterId ? (
                  <p>{locale === 'pl' ? 'Wykonawca' : 'Crafter'}: {itemization.origin.crafterCharacterId}</p>
                ) : null}
                <p>Content v{itemization.origin.contentVersion} · snapshot v{itemization.snapshotVersion}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-3 space-y-1 border-t border-white/10 pt-2 text-xs">
            {item.quantity !== undefined && item.stackLimit !== undefined ? (
              <p className="text-slate-400">
                {locale === 'pl' ? 'Ilość' : 'Quantity'}: {item.quantity}/{item.stackLimit}
              </p>
            ) : null}
            {item.buyPriceSilver !== undefined ? (
              <p className="text-amber-200">
                {locale === 'pl' ? 'Kupno' : 'Buy'}: {item.buyPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}
              </p>
            ) : null}
            {item.sellPriceSilver !== undefined ? (
              <p className="text-amber-200">
                {locale === 'pl' ? 'Sprzedaż' : 'Sell'}: {item.sellPriceSilver} {locale === 'pl' ? 'srebra' : 'silver'}
              </p>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
