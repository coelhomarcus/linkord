import { SidebarSimpleIcon, XIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { useAppModalClose } from '@/shared/ui/app-modal';
import { Button } from '@/shared/ui/primitives/button';

/** Header of a full-page screen (friends, requests) or of an area shown in a
 * modal (settings, administration). On mobile the sidebar is a sheet, so a page
 * has no other way back to the conversation list: the header carries the button
 * that reopens it. In a modal that button gives way to one that closes it. */
export function PageHeader({ title, subtitle, actions, leading, middle }: { title: string; subtitle?: string; actions?: ReactNode; leading?: ReactNode; middle?: ReactNode }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeModal = useAppModalClose();
  return (
    <header className="flex flex-none items-center gap-3 border-b border-border px-4 py-3 md:px-6">
      {isMobile && !closeModal && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Abrir lista de conversas" onClick={() => setOpenMobile(true)}>
          <SidebarSimpleIcon size={20} />
        </Button>
      )}
      {leading}
      <div className="min-w-0 flex-1">
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
