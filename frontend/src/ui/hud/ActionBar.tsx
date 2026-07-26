import { useEffect, useState } from 'react';

const slots = [
  { icon: '✦', label: 'Arcane Spark' },
  { icon: '◆', label: 'Health Potion' },
  { icon: '➶', label: 'Quick Shot' },
  { icon: '✥', label: 'Guard' },
  { icon: '☄', label: 'Meteor' },
  { icon: '◈', label: 'Focus' },
  { icon: '▱', label: 'Town Scroll' },
  { icon: '●', label: 'Rations' },
] as const;

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function ActionBar(): React.JSX.Element {
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
    <section className="hud-panel pointer-events-auto flex gap-1.5 p-2" aria-label="Mock quick actions">
      {slots.map((slot, index) => (
        <button key={slot.label} type="button" title={`${slot.label} (visual mock)`} onClick={() => { setActive(index); window.setTimeout(() => setActive(undefined), 180); }} className={`action-slot ${active === index ? 'action-slot-active' : ''}`}>
          <span className="text-xl">{slot.icon}</span><kbd>{index + 1}</kbd>
        </button>
      ))}
    </section>
  );
}
