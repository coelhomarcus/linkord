import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProhibitIcon } from '@phosphor-icons/react';

import { useExitPresence } from '@/shared/hooks/useExitPresence';
import { cn } from '@/shared/lib/utils';
import type { DragSummary } from './dragSummary';

export interface DropTarget {
  /** a server channel's name, shown as `#name` */
  channel?: string;
  /** a DM peer's display name, shown as `@name` */
  peer?: string;
}

const MOTION = 'motion-popup data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98] data-closed:fill-mode-forwards';

export function DropOverlay({ drag, target, allowed }: { drag: DragSummary | null; target: DropTarget; allowed: boolean }) {
  const { t } = useTranslation('chat');
  const open = drag !== null;
  const { ref, mounted } = useExitPresence(open);
  // keeps what it said while it fades out: the drag is already gone by then
  const [shown, setShown] = useState({ drag, allowed });
  if (drag && (drag !== shown.drag || allowed !== shown.allowed)) setShown({ drag, allowed });
  if (!mounted || !shown.drag) return null;

  const { count, icon: TypeIcon, iconBgClassName, iconTextClassName } = shown.drag;
  const title = shown.allowed
    ? target.channel !== undefined ? t('drop.toChannel', { channel: target.channel })
      : target.peer !== undefined ? t('drop.toDirect', { name: target.peer }) : t('drop.toConversation')
    : target.channel !== undefined ? t('drop.notAllowedChannel', { channel: target.channel })
      : target.peer !== undefined ? t('drop.notAllowedDirect', { name: target.peer }) : t('drop.notAllowed');

  return (
    <div
      ref={ref}
      data-drop-overlay={shown.allowed ? 'allowed' : 'refused'}
      data-open={open ? '' : undefined}
      data-closed={open ? undefined : ''}
      className={cn(
        'pointer-events-none absolute inset-0 z-10 m-2 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-(--surface-base)/90 px-6 text-center',
        shown.allowed ? 'border-primary' : 'border-red',
        MOTION,
      )}
    >
      {shown.allowed ? (
        <div className={cn('grid size-14 place-items-center rounded-xl', iconBgClassName)}>
          <TypeIcon size={28} aria-hidden className={iconTextClassName} />
        </div>
      ) : (
        <div className="grid size-14 place-items-center rounded-xl bg-red/10">
          <ProhibitIcon size={28} aria-hidden className="text-red" />
        </div>
      )}
      <div className="flex max-w-full flex-col gap-1">
        <p className={cn('truncate text-body font-medium', shown.allowed ? 'text-text-primary' : 'text-red-text')}>{title}</p>
        {count > 0 && <p className="text-label text-text-muted">{t('drop.files', { count })}</p>}
      </div>
    </div>
  );
}
