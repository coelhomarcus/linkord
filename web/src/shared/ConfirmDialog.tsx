import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel, cancelLabel, destructive = false, onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const resolvedConfirmLabel = confirmLabel ?? t('confirm.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('confirm.cancel');
  function handleConfirm() {
    onConfirm();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-100">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-semibold text-text-primary">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <DialogDescription className="select-none text-body text-text-secondary">{description}</DialogDescription>
        </div>
        <DialogFooter className="border-border-subtle bg-bg-tertiary/60 px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <span>{resolvedCancelLabel}</span>
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm}>
            <span>{resolvedConfirmLabel}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
