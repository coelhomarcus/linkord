import { CircleNotchIcon } from '@phosphor-icons/react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { UploadProgressBar } from './UploadProgressBar';

interface UploadProgressModalProps {
  open: boolean;
  title: string;
  description?: string;
  /** Omit when the operation has no meaningful client-side percentage. */
  progress?: number;
}

/** Blocking modal shown for the duration of an avatar/banner upload — a
 * non-dismissable Dialog (same pattern as EmailRequiredModal: `onOpenChange`
 * is a no-op, `showCloseButton={false}`) so the person can't lose track of
 * it by scrolling the settings panel or switching tabs while it's running. */
export function UploadProgressModal({ open, title, description, progress }: UploadProgressModalProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="max-w-sm bg-bg-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleNotchIcon size={16} className="flex-none animate-spin text-primary" />
            <span>{title}</span>
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {progress !== undefined && (
          <div className="flex items-center gap-2">
            <UploadProgressBar progress={progress} />
            <span className="flex-none text-caption tabular-nums text-text-muted">{Math.round(progress * 100)}%</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
