import { useRef, useState } from 'react';
import { describeApiError } from '@/shared/api/errorText';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmDialogProps = ConfirmDialogOptions & (
  | { onConfirm: () => void; onConfirmAsync?: never }
  | { onConfirm?: never; onConfirmAsync: () => Promise<unknown> }
);

export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel, cancelLabel, destructive = false, onConfirm, onConfirmAsync,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const resolvedConfirmLabel = confirmLabel ?? t('confirm.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('confirm.cancel');
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(open: boolean) {
    if (pending.current) return;
    if (!open) setError(null);
    onOpenChange(open);
  }

  async function handleConfirm() {
    if (pending.current) return;
    if (!onConfirmAsync) {
      onConfirm?.();
      close(false);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    let succeeded = false;
    try {
      await onConfirmAsync();
      succeeded = true;
    } catch (err) {
      setError(describeApiError(err));
    }
    pending.current = false;
    setBusy(false);
    if (succeeded) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={!busy} className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-100">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-semibold text-text-primary">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <DialogDescription className="select-none text-body wrap-anywhere text-text-secondary">{description}</DialogDescription>
          {error && <div role="alert" className="mt-3"><ErrorBanner>{error}</ErrorBanner></div>}
        </div>
        <DialogFooter className="border-border-divider bg-bg-tertiary/60 px-6 py-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>
            <span>{resolvedCancelLabel}</span>
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={busy} aria-busy={busy || undefined} onClick={() => void handleConfirm()}>
            <span>{resolvedConfirmLabel}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
