import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';

interface UnsavedProfileChangesDialogProps {
  open: boolean;
  saving: boolean;
  error: string | null;
  onContinueEditing: () => void;
  onDiscardAndLeave: () => void;
  onSaveAndLeave: () => void;
}

/** Three-way exit prompt for a dirty profile draft — the generic
 * ConfirmDialog is confirm/cancel only, so this reuses the same Dialog
 * primitives instead of trying to force a third action into it. */
export function UnsavedProfileChangesDialog({
  open, saving, error, onContinueEditing, onDiscardAndLeave, onSaveAndLeave,
}: UnsavedProfileChangesDialogProps) {
  const { t } = useTranslation('profile');
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onContinueEditing(); }}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-100">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-semibold text-text-primary">{t('unsaved.title')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <DialogDescription className="select-none text-body text-text-secondary">
            {t('unsaved.description')}
          </DialogDescription>
          {error && <p role="alert" className="mt-3 text-label text-red-text">{error}</p>}
        </div>
        {/* Three real choices with long labels never fit one row at this
            dialog's width — always stacked. DialogFooter's own default
            switches to a row at sm:, so that has to be overridden too, not
            just the base flex-col (a plain flex-col here left sm:flex-row
            winning at anything sm-and-up and silently squashing/hiding two
            of the three buttons — caught only by looking at a screenshot). */}
        <DialogFooter className="flex-col gap-2 border-border-subtle bg-bg-tertiary/60 px-6 py-4 sm:flex-col sm:justify-start">
          <Button type="button" className="w-full" onClick={onSaveAndLeave} disabled={saving}>
            <span>{saving ? t('unsaved.saving') : t('unsaved.saveAndLeave')}</span>
          </Button>
          <Button type="button" variant="outline" className="w-full text-red hover:bg-red/12" onClick={onDiscardAndLeave} disabled={saving}>
            <span>{t('unsaved.discardAndLeave')}</span>
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={onContinueEditing} disabled={saving}>
            <span>{t('unsaved.continueEditing')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
