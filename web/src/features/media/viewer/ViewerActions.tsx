import { ArrowSquareOutIcon, DotsThreeIcon, DownloadSimpleIcon, ImageSquareIcon, LinkIcon } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CopyStatusIcon } from '@/shared/CopyFeedback';
import { COPIED_FOR_MS, useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { useTransientFlag } from '@/shared/hooks/useTransientFlag';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { downloadFile } from '@/shared/lib/download';
import { cn } from '@/shared/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { canCopyImages, copyImageToClipboard } from './copyImage';
import { isStill } from './viewerItem';
import { absoluteUrl, viewerIconButton } from './viewerStyles';
import type { ViewerItem } from './viewerItem';

/** Something the viewer offers beyond the item itself, such as replying to its message. */
export interface ViewerAction {
  id: string;
  label: string;
  icon: Icon;
  /** `shiftKey` lets a destructive one skip its confirmation, as the message menu does */
  onSelect: (event: { shiftKey: boolean }) => void;
  destructive?: boolean;
}

/** The top bar's actions on a pointer device: the item's own as buttons, the message's in a menu. */
export function ViewerActionBar({ item, extraActions }: { item: ViewerItem; extraActions: ViewerAction[] }) {
  const { t } = useTranslation('media');
  const { copied, copy, reset } = useCopyToClipboard();
  const [lastKey, setLastKey] = useState(item.key);
  if (lastKey !== item.key) { setLastKey(item.key); reset(); }
  const copyImage = isStill(item) && canCopyImages();

  return (
    <>
      <button type="button" aria-label={t('viewer.download')} title={t('viewer.download')} onClick={() => downloadFile(item.originalSrc, item.name)} className={viewerIconButton}>
        <DownloadSimpleIcon size={18} aria-hidden />
      </button>
      <a href={item.originalSrc} target="_blank" rel="noopener noreferrer" aria-label={t('viewer.openOriginal')} title={t('viewer.openOriginal')} className={viewerIconButton}>
        <ArrowSquareOutIcon size={18} aria-hidden />
      </a>
      <button type="button" aria-label={t('viewer.copyLink')} title={t('viewer.copyLink')} onClick={() => void copy(absoluteUrl(item.originalSrc))} className={viewerIconButton}>
        <CopyStatusIcon copied={copied} size={18} icon={LinkIcon} />
      </button>
      {copyImage && <CopyImageButton src={item.src} itemKey={item.key} />}
      {extraActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" aria-label={t('viewer.moreActions')} title={t('viewer.moreActions')} className={viewerIconButton} />}>
            <DotsThreeIcon size={20} weight="bold" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {extraActions.map((action, index) => (
              <ActionMenuItem key={action.id} action={action} separated={!!action.destructive && index > 0 && !extraActions[index - 1]!.destructive} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

function ActionMenuItem({ action, separated }: { action: ViewerAction; separated: boolean }) {
  const Icon = action.icon;
  return (
    <>
      {separated && <DropdownMenuSeparator />}
      <DropdownMenuItem variant={action.destructive ? 'destructive' : 'default'} onClick={(event) => action.onSelect({ shiftKey: event.shiftKey })}>
        <Icon size={16} />
        <span>{action.label}</span>
      </DropdownMenuItem>
    </>
  );
}

function CopyImageButton({ src, itemKey }: { src: string; itemKey: string }) {
  const { t } = useTranslation('media');
  const [copied, raise, reset] = useTransientFlag(COPIED_FOR_MS);
  const [lastKey, setLastKey] = useState(itemKey);
  if (lastKey !== itemKey) { setLastKey(itemKey); reset(); }
  return (
    <button
      type="button"
      aria-label={t('viewer.copyImage')}
      title={t('viewer.copyImage')}
      onClick={() => { void copyImageToClipboard(src).then((ok) => { if (ok) raise(); }); }}
      className={viewerIconButton}
    >
      <CopyStatusIcon copied={copied} size={18} icon={ImageSquareIcon} />
    </button>
  );
}

/** On a phone, every action in one sheet from the bottom, opened by the "more actions" button (a
 * dialog nested in the viewer's own, so it stays reachable while the viewer holds the focus). */
export function ViewerActionSheet({ item, extraActions }: { item: ViewerItem; extraActions: ViewerAction[] }) {
  const { t } = useTranslation('media');
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  const copyImage = isStill(item) && canCopyImages();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger render={<button type="button" aria-label={t('viewer.moreActions')} className={viewerIconButton} />}>
        <DotsThreeIcon size={22} weight="bold" aria-hidden />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 motion-modal data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-bg-modal pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-text-primary shadow-popover outline-none motion-modal data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-8 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-8"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogPrimitive.Title className="truncate px-5 pb-2 pt-1 text-caption text-text-muted">{item.name}</DialogPrimitive.Title>
          <SheetRow icon={DownloadSimpleIcon} onClick={run(() => downloadFile(item.originalSrc, item.name))}>{t('viewer.download')}</SheetRow>
          <SheetRow icon={ArrowSquareOutIcon} onClick={run(() => window.open(item.originalSrc, '_blank', 'noopener,noreferrer'))}>{t('viewer.openOriginal')}</SheetRow>
          <SheetRow icon={LinkIcon} onClick={run(() => void copyToClipboard(absoluteUrl(item.originalSrc)))}>{t('viewer.copyLink')}</SheetRow>
          {copyImage && <SheetRow icon={ImageSquareIcon} onClick={run(() => void copyImageToClipboard(item.src))}>{t('viewer.copyImage')}</SheetRow>}
          {extraActions.length > 0 && <div aria-hidden className="mx-5 my-1 h-px bg-border" />}
          {extraActions.map((action) => (
            <SheetRow key={action.id} icon={action.icon} destructive={action.destructive} onClick={run(() => action.onSelect({ shiftKey: false }))}>{action.label}</SheetRow>
          ))}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetRow({ icon: Icon, destructive, onClick, children }: { icon: Icon; destructive?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 px-5 text-left text-body outline-none transition-colors duration-100 ease-out-expo active:bg-fill-hover focus-visible:bg-fill-hover motion-reduce:transition-none',
        destructive ? 'text-red-text' : 'text-text-primary',
      )}
    >
      <Icon size={20} aria-hidden className={destructive ? 'text-red-text' : 'text-text-secondary'} />
      <span>{children}</span>
    </button>
  );
}
