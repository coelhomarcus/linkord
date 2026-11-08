import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/primitives/button';

// Everything on the profile that waits for a Save (the profile fields, the Wall) shows its bar in one
// place, floating over the bottom of the profile. The editor owns the slot; the bars stack in it, so two
// pending changes never cover each other.
const SlotContext = createContext<HTMLElement | null>(null);
export const FloatingBarSlotProvider = SlotContext.Provider;

/** Where the floating bars of the profile appear: over the bottom of the modal, centered. */
export const FLOATING_BAR_SLOT_CLASS = 'pointer-events-none absolute bottom-4 left-1/2 z-10 flex w-[min(100%-2rem,28rem)] -translate-x-1/2 flex-col gap-2 [&>*]:pointer-events-auto';
const BAR = 'flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-bg-floating/95 px-4 py-3 shadow-popover backdrop-blur-xl';

export type SaveBarStatus = 'pending' | 'saving' | 'error' | 'saved';

/** The one bar every pending change on the profile shows, so the text, the buttons and their order are the
 * same everywhere: the message, then Reset (secondary) and Save (primary). Without `onSave` Save submits
 * the form the bar is in. `onReset` is left out when there is nothing to reset (a failed save with no edits). */
export function FloatingBar({ label, status, error, onReset, onSave }: {
  label: string;
  status: SaveBarStatus;
  /** shown instead of the reminder when `status` is `error` */
  error?: string | null;
  onReset?: () => void;
  onSave?: () => void;
}) {
  const { t } = useTranslation('profile');
  const slot = useContext(SlotContext);
  const saving = status === 'saving';
  const bar = (
    <div role="region" aria-label={label} className={slot ? BAR : `${BAR} sticky bottom-4 z-10`}>
      {status === 'saved' ? (
        <p role="status" className="text-label font-medium text-green">{t('bar.saved')}</p>
      ) : status === 'error' ? (
        <p role="alert" className="text-label text-red">{error}</p>
      ) : (
        <p className="text-label text-text-muted">{t(saving ? 'bar.saving' : 'bar.unsaved')}</p>
      )}
      {status !== 'saved' && (
        <div className="flex gap-2">
          {onReset && <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onReset}>{t('bar.reset')}</Button>}
          <Button type={onSave ? 'button' : 'submit'} size="sm" disabled={saving} onClick={onSave}>{t(saving ? 'bar.saving' : 'bar.save')}</Button>
        </div>
      )}
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}
