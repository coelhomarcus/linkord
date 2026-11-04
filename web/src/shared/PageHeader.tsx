import { XIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useAppModalClose } from '@/shared/ui/app-modal';
import { Button } from '@/shared/ui/primitives/button';
import { useTranslation } from 'react-i18next';

/** Header of a full-page screen or a modal area. */
export function PageHeader({ title, subtitle, actions, leading, middle }: { title: string; subtitle?: string; actions?: ReactNode; leading?: ReactNode; middle?: ReactNode }) {
  const { t } = useTranslation('common');
  const closeModal = useAppModalClose();
  return (
    <header className="flex h-header flex-none items-center gap-3 px-4 md:border-b md:border-border-subtle">
      {leading}
      <div className="min-w-0 flex-1 select-none">
        <h1 className="truncate text-body font-semibold text-text-strong">{title}</h1>
        {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
      </div>
      {middle}
      {actions}
      {closeModal && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('page.close')} onClick={closeModal} className="flex-none text-text-secondary hover:bg-transparent hover:text-text-primary">
          <XIcon size={24} />
        </Button>
      )}
    </header>
  );
}
