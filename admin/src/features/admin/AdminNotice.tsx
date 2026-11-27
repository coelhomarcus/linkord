import { InfoIcon } from '@/shared/ui/icons';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

const NOTICE_TONES = {
  info: { box: 'border-accent-primary/70 bg-accent-primary/8', icon: 'text-accent-primary' },
  warning: { box: 'border-yellow/60 bg-yellow/8', icon: 'text-yellow' },
  danger: { box: 'border-red/60 bg-red/8', icon: 'text-red' },
} as const;

/** Shows feedback at the top of a section, with room for a retry action. */
export function AdminNotice({ children, tone = 'info', action }: { children: ReactNode; tone?: keyof typeof NOTICE_TONES; action?: ReactNode }) {
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={cn('flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-label text-text-primary', NOTICE_TONES[tone].box)}>
      <InfoIcon size={20} weight="fill" aria-hidden className={cn('mt-px flex-none', NOTICE_TONES[tone].icon)} />
      <div className="min-w-0 flex-1 basis-48">{children}</div>
      {action && <div className="flex flex-none items-center">{action}</div>}
    </div>
  );
}
