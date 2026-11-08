import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { DisplayStatus } from './statusDisplay';

const FILL: Record<DisplayStatus | 'reconnecting', string> = {
  online: 'bg-green',
  idle: 'bg-yellow',
  dnd: 'bg-red',
  invisible: 'bg-text-muted',
  offline: 'bg-text-muted',
  reconnecting: 'bg-text-muted',
};

/** The presence dot laid over an avatar. The ring around it and the shapes cut into it (idle's
 * crescent, do not disturb's bar, invisible's hole) are drawn in the text color, so the caller sets
 * that to the surface the avatar sits on (`text-surface-app` and so on) along with size, border
 * width and position. Shape as well as color tells the statuses apart. */
export function StatusDot({ status, className, labelled = false }: {
  status: DisplayStatus | 'reconnecting';
  className?: string;
  /** announces the status (an image with a name) instead of hiding the dot from assistive tech */
  labelled?: boolean;
}) {
  const { t } = useTranslation('status');
  const label = status === 'reconnecting' ? undefined : t(`statuses.${status}`);
  return (
    <span
      data-status={status}
      {...(labelled && label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('relative block overflow-hidden rounded-full border-current', FILL[status], className)}
    >
      {status === 'idle' && <span className="absolute top-0 left-0 size-1/2 rounded-full bg-current" />}
      {status === 'dnd' && <span className="absolute top-1/2 left-1/2 h-1/4 w-3/4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />}
      {status === 'invisible' && <span className="absolute top-1/2 left-1/2 size-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />}
    </span>
  );
}
