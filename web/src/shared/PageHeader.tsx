import { XIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useAppModalClose } from '@/shared/ui/app-modal';
import { Button } from '@/shared/ui/primitives/button';

/** Header of a full-page screen or a modal area. */
export function PageHeader({ title, subtitle, actions, leading, middle }: { title: string; subtitle?: string; actions?: ReactNode; leading?: ReactNode; middle?: ReactNode }) {
  const closeModal = useAppModalClose();
  return (
    <header className="flex h-header flex-none items-center gap-3 px-4 md:border-b md:border-border md:px-6">
      {leading}
      <div className="min-w-0 flex-1 select-none">
        <h1 className="truncate text-title font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
      </div>
      {middle}
      {actions}
      {closeModal && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar" onClick={closeModal} className="flex-none text-text-muted hover:text-text-primary">
          <XIcon size={20} />
        </Button>
      )}
    </header>
  );
}
