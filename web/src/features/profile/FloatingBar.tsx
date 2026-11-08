import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Everything on the profile that waits for a Save (the profile fields, the Wall) shows its bar in one
// place, floating over the bottom of the profile. The editor owns the slot; the bars stack in it, so two
// pending changes never cover each other.
const SlotContext = createContext<HTMLElement | null>(null);
export const FloatingBarSlotProvider = SlotContext.Provider;

/** Where the floating bars of the profile appear: over the bottom of the modal, centered. */
export const FLOATING_BAR_SLOT_CLASS = 'pointer-events-none absolute bottom-4 left-1/2 z-10 flex w-[min(100%-2rem,28rem)] -translate-x-1/2 flex-col gap-2 [&>*]:pointer-events-auto';
const BAR = 'flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-bg-floating/95 px-4 py-3 shadow-popover backdrop-blur-xl';

/** A bar with a message and the buttons that answer it. Outside the profile editor (no slot) it sticks to
 * the bottom of what it is in. */
export function FloatingBar({ label, children }: { label: string; children: ReactNode }) {
  const slot = useContext(SlotContext);
  const bar = <div role="region" aria-label={label} className={slot ? BAR : `${BAR} sticky bottom-4 z-10`}>{children}</div>;
  return slot ? createPortal(bar, slot) : bar;
}
