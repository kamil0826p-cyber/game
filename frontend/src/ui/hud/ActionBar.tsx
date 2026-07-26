import { useEffect, useState } from 'react';
import type { TranslationKey } from '../../i18n/dictionaries';
import { useI18n } from '../../i18n/I18nProvider';

const slots: ReadonlyArray<{ icon: string; labelKey: TranslationKey }> = [
  { icon: '✦', labelKey: 'hud.action.arcaneSpark' },
  { icon: '◆', labelKey: 'hud.action.healthPotion' },
  { icon: '➶', labelKey: 'hud.action.quickShot' },
  { icon: '✥', labelKey: 'hud.action.guard' },
  { icon: '☄', labelKey: 'hud.action.meteor' },
  { icon: '◈', labelKey: 'hud.action.focus' },
  { icon: '▱', labelKey: 'hud.action.townScroll' },
  { icon: '●', labelKey: 'hud.action.rations' },
];

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function ActionBar(): React.JSX.Element {
  const { t } = useI18n();
  const [active, setActive] = useState<number | undefined>(undefined);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < slots.length) {
        setActive(index);
        window.setTimeout(() => setActive((current) => current === index ? undefined : current), 180);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <section className="hud-panel hud-tooltip-container pointer-events-auto flex gap-1.5 p-2" aria-label="Quick actions">
      {slots.map((slot, index) => {
        const label = t(slot.labelKey);
        return (
          <button
            key={slot.labelKey}
            type="button"
            aria-label={`${label} (${index + 1})`}
            data-tooltip={label}
            data-tooltip-hotkey={index + 1}
            onClick={() => {
              setActive(index);
              window.setTimeout(() => setActive(undefined), 180);
            }}
            className={`action-slot hud-tooltip hud-tooltip-top ${active === index ? 'action-slot-active' : ''}`}
          >
            <span className="text-xl">{slot.icon}</span><kbd>{index + 1}</kbd>
          </button>
        );
      })}
    </section>
  );
}
