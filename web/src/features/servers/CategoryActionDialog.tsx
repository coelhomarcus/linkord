import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { FloatingBar } from '@/shared/FloatingBar';
import { useSaveBar } from '@/shared/hooks/useSaveBar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import type { CategorySummary } from '@/shared/types/protocol';
import { deleteCategory, updateCategory } from './serversApi';

export function CategoryActionDialog({ category, action, onClose }: {
  category: CategorySummary; action: 'rename' | 'delete'; onClose: () => void;
}) {
  const { t } = useTranslation('servers');
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? category.name;
  const edited = name.trim() !== category.name;
  const bar = useSaveBar(name, edited);
  const saving = useRef(false);

  if (action === 'delete') {
    return (
      <ConfirmDialog open onOpenChange={(open) => { if (!open) onClose(); }}
        title={t('category.deleteTitle', { name: category.name })}
        description={t('category.deleteDescription')}
        confirmLabel={t('category.delete')} destructive
        onConfirmAsync={() => deleteCategory(category.id)}
      />
    );
  }

  async function save() {
    if (saving.current || !edited || !name.trim()) return;
    saving.current = true;
    await bar.save(async () => { await updateCategory(category.id, name.trim()); onClose(); });
    saving.current = false;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('category.rename')}</DialogTitle></DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium">{t('channel.categoryName')}</span>
            <Input value={name} autoFocus maxLength={100} disabled={bar.status === 'saving'}
              onChange={(event) => { setDraft(event.target.value); bar.clearError(); }} />
          </label>
          <FloatingBar open={bar.visible} label={t('category.rename')} status={bar.status} error={bar.error} saveDisabled={!name.trim()}
            onReset={() => { setDraft(null); bar.clearError(); }} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
