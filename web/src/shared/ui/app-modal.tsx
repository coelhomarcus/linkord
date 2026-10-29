import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';
import { Dialog, DialogContent } from '@/shared/ui/primitives/dialog';

const AppModalContext = createContext<(() => void) | null>(null);

/** The close handler of the app modal this is rendered in, or null outside
 * one. A page header uses it to swap "open the conversation list" for a close
 * button when it is shown in a modal instead of the content area. */
export function useAppModalClose(): (() => void) | null {
  return useContext(AppModalContext);
}

/** A near full-screen modal for a whole area (settings, administration), like
 * the ones Discord opens over the app: the page keeps its own header and
 * layout, and the app stays visible and untouched behind it. Always open while
 * mounted; closing asks the owner to unmount it (Esc, the backdrop or the
 * header's close button). */
export function AppModal({ label, onClose, size = 'lg', children }: {
  /** the accessible name of the dialog */
  label: string;
  onClose: () => void;
  /** lg: a whole area (administration, media); form: a navigation column
   * beside one 760px page of fields (settings), where more width is only an
   * empty strip on the right; md: one thing's details, which would drown in
   * that much space */
  size?: 'lg' | 'form' | 'md';
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label={label}
        className={cn(
          'top-1/2 left-1/2 max-w-none gap-0 overflow-hidden border border-border bg-surface-panel p-0 text-text-primary [--surface-base:var(--color-surface-panel)] sm:max-w-none max-sm:w-screen max-sm:rounded-none max-sm:border-0',
          // full screen on a phone, over the part the keyboard leaves visible and clear of the notch and home indicator
          'max-sm:top-(--app-top) max-sm:h-(--app-height) max-sm:translate-y-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-(--safe-bottom)',
          size === 'md' && 'h-[min(40rem,calc(100dvh-3rem))] w-[min(56rem,calc(100vw-3rem))]',
          size === 'form' && 'h-[min(54rem,calc(100dvh-3rem))] w-[min(64rem,calc(100vw-3rem))]',
          size === 'lg' && 'h-[min(54rem,calc(100dvh-3rem))] w-[min(76rem,calc(100vw-3rem))]',
        )}
      >
        <AppModalContext.Provider value={onClose}>
          <div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>
        </AppModalContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
