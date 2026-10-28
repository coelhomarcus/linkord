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
  /** lg: a whole area (settings, administration, media); md: one thing's
   * details, which would drown in that much space */
  size?: 'lg' | 'md';
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label={label}
        className={cn(
          'top-1/2 left-1/2 max-w-none gap-0 overflow-hidden border border-border bg-surface-panel p-0 text-text-primary [--surface-base:var(--color-surface-panel)] sm:max-w-none max-sm:h-dvh max-sm:w-screen max-sm:rounded-none',
          size === 'md'
            ? 'h-[min(40rem,calc(100dvh-3rem))] w-[min(56rem,calc(100vw-3rem))]'
            : 'h-[min(54rem,calc(100dvh-3rem))] w-[min(76rem,calc(100vw-3rem))]',
        )}
      >
        <AppModalContext.Provider value={onClose}>
          <div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>
        </AppModalContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
