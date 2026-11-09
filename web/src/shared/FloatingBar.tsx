import { createContext, memo, useContext } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';
import { useExitPresence } from '@/shared/hooks/useExitPresence';

// A screen where several things wait for a Save (the profile fields and the Wall) shows their bars in one
// place: the screen owns a slot and the bars stack in it, so two pending changes never cover each other.
const SlotContext = createContext<HTMLElement | null>(null);
export const FloatingBarSlotProvider = SlotContext.Provider;

/** Where the floating bars of a slot appear: over the bottom of what holds it, centered. */
export const FLOATING_BAR_SLOT_CLASS = 'pointer-events-none absolute bottom-4 left-1/2 z-10 flex w-[min(100%-2rem,28rem)] -translate-x-1/2 flex-col gap-2 [&>*]:pointer-events-auto';
const BAR = 'flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-bg-floating/95 px-4 py-3 shadow-popover backdrop-blur-xl';
// Rises a little as it appears and sinks back as it goes; fill-mode keeps it hidden between the end of the
// exit and the unmount. Shared with other floating cards (the install banner) so they move alike.
export const FLOATING_BAR_MOTION = 'ease-out-expo data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-open:duration-200 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-2 data-closed:duration-150 data-closed:fill-mode-forwards';

/** How long the bar confirms a save before it goes away. */
export const SAVED_BAR_MS = 2200;

export type SaveBarStatus = 'pending' | 'saving' | 'error' | 'saved';

// While the bar leaves it keeps what it said: the change that made it go (a reset, the saved confirmation
// timing out) would otherwise flash the reminder on its way out. memo skips every render once frozen.
const Frozen = memo(function Frozen({ children }: { children: ReactNode; frozen: boolean }) {
  return children;
}, (_previous, next) => next.frozen);

/** The one bar every screen with pending changes shows, so the text, the buttons and their order are the
 * same everywhere: the message, then Reset (secondary) and Save (primary). Without `onSave` Save submits
 * the form the bar is in. `onReset` is left out when there is nothing to reset (a failed save with no edits).
 * Rendered with `open` rather than conditionally, so it can animate out. */
export function FloatingBar({ open = true, label, status, error, onReset, onSave, saveDisabled }: {
  /** whether the bar shows; once false, it plays its exit with what it showed last, taking no input */
  open?: boolean;
  label: string;
  status: SaveBarStatus;
  /** shown instead of the reminder when `status` is `error` */
  error?: string | null;
  onReset?: () => void;
  onSave?: () => void;
  /** the edits can't be saved as they are (a required field left empty) */
  saveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const slot = useContext(SlotContext);
  const { ref, mounted } = useExitPresence(open);
  const saving = status === 'saving';
  if (!mounted) return null;
  const bar = (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      data-open={open ? '' : undefined}
      data-closed={open ? undefined : ''}
      inert={!open}
      className={`${slot ? BAR : `${BAR} sticky bottom-4 z-10`} ${FLOATING_BAR_MOTION}`}
    >
      <Frozen frozen={!open}>
        {status === 'saved' ? (
          <p role="status" className="text-label font-medium text-green">{t('saveBar.saved')}</p>
        ) : status === 'error' ? (
          <p role="alert" className="text-label text-red">{error}</p>
        ) : (
          <p className="text-label text-text-muted">{t(saving ? 'saveBar.saving' : 'saveBar.unsaved')}</p>
        )}
        {status !== 'saved' && (
          <div className="ml-auto flex gap-2">
            {onReset && <Button type="button" variant="secondary" size="sm" className="touch-target relative" disabled={saving} onClick={onReset}>{t('saveBar.reset')}</Button>}
            <Button type={onSave ? 'button' : 'submit'} size="sm" className="touch-target relative" disabled={saving || saveDisabled} onClick={onSave}>{t(saving ? 'saveBar.saving' : 'saveBar.save')}</Button>
          </div>
        )}
      </Frozen>
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}
