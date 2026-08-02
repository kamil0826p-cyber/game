import type { ReactNode } from 'react';
import type { EquipmentSlot } from '../../contracts/socket';

const glyphs: Record<EquipmentSlot, ReactNode> = {
  HEAD: (
    <>
      <path d="M10 19v-5.5C10 8.8 13.6 5 18 5s8 3.8 8 8.5V19" />
      <path d="M8 19h20l-2 7H10l-2-7Z" />
      <path d="M14 19v-5m8 5v-5M18 5v7" />
    </>
  ),
  AMULET: (
    <>
      <path d="M10 7c2.2 6.7 4.9 10 8 10s5.8-3.3 8-10" />
      <path d="m18 15 5 5-5 8-5-8 5-5Z" />
      <path d="M18 18v6" />
    </>
  ),
  CHEST: (
    <>
      <path d="m10 8 5-3h6l5 3 4 7-5 3v11H11V18l-5-3 4-7Z" />
      <path d="m15 5 3 6 3-6M11 18h14M18 11v18" />
      <path d="m13 13 5 4 5-4" />
    </>
  ),
  MAIN_HAND: (
    <>
      <path d="m24 5 5 5-13 13-5-5L24 5Z" />
      <path d="m9 20 7 7m-10-3 6 6m-1-8-5 5" />
      <path d="M25 6 29 4l-2 4" />
    </>
  ),
  OFF_HAND: (
    <>
      <path d="M18 4 29 8v8c0 7.3-4.3 12.5-11 16-6.7-3.5-11-8.7-11-16V8l11-4Z" />
      <path d="M18 8v19M10 12h16" />
      <path d="m11 12 7 5 7-5" />
    </>
  ),
  RING: (
    <>
      <path d="m13 11 5-6 5 6-5 4-5-4Z" />
      <ellipse cx="18" cy="22" rx="9" ry="8" />
      <path d="M13 11c-2.5 2.2-4 6-4 10m14-10c2.5 2.2 4 6 4 10" />
    </>
  ),
  LEGS: (
    <>
      <path d="M12 5h12l3 8-4 18h-6l1-13-1 13h-6L7 13l5-8Z" />
      <path d="M10 12h16M18 5v13" />
    </>
  ),
  FEET: (
    <>
      <path d="M9 6h8v14l-4 7H5v-5l4-5V6Zm10 0h8v11l4 5v5h-8l-4-7V6Z" />
      <path d="M5 27h8m10 0h8M9 12h8m2 0h8" />
    </>
  ),
};

export function EquipmentSlotGlyph({ slot }: { slot: EquipmentSlot }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="equipment-slot-glyph"
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {glyphs[slot]}
    </svg>
  );
}
