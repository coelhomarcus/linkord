import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

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
export function AppModal({ label, onClose, children }: {
  /** the accessible name of the dialog */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label={label}
        className="top-1/2 left-1/2 h-[min(54rem,calc(100dvh-3rem))] w-[min(76rem,calc(100vw-3rem))] max-w-none gap-0 overflow-hidden border border-border bg-surface-panel p-0 text-text-primary [--surface-base:var(--color-surface-panel)] sm:max-w-none max-sm:h-dvh max-sm:w-screen max-sm:rounded-none"
      >
        <AppModalContext.Provider value={onClose}>
          <div className="flex h-full min-h-0 flex-col">{children}</div>
        </AppModalContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
