import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { useRowMenu } from '@/shared/hooks/useRowMenu';
import { DotsThreeIcon } from '@/shared/ui/icons';
import { DropdownMenu, DropdownMenuContent } from '@/shared/ui/primitives/dropdown-menu';
import { cn } from '@/shared/lib/utils';

export function RowMenu({ menu, children }: { menu: ReturnType<typeof useRowMenu>; children: ReactNode }) {
  if (!menu.anchor) return null;
  return (
    <DropdownMenu modal={false} open={menu.open} onOpenChange={menu.setOpen}
      onOpenChangeComplete={(open) => { if (!open && !menu.open) menu.clearAnchor(); }}>
      <DropdownMenuContent anchor={menu.anchor} finalFocus={menu.opener} className="data-closed:pointer-events-none">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RowMenuButton({ menu, name, className, disabled }: {
  menu: ReturnType<typeof useRowMenu>; name: string; className?: string; disabled?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <button type="button" aria-label={t('contextMenu.moreFor', { name })} aria-haspopup="menu" aria-expanded={menu.open} disabled={disabled}
      className={cn('grid flex-none place-items-center rounded-sm text-text-secondary hover:text-text-primary focus-ring', className)} onClick={menu.openFromButton}>
      <DotsThreeIcon size={18} weight="fill" />
    </button>
  );
}
