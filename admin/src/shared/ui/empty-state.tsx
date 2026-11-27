import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';
export function EmptyState({ title, description, action, size = 'default', className }: {
  title: string;
  description?: ReactNode;
  /** one or two buttons; a lone link-style action reads better as a Button too */
  action?: ReactNode;
  size?: 'default' | 'compact';
  className?: string;
}) {
  const compact = size === 'compact';
  return (
    <div data-slot="empty-state" className={cn('flex select-none flex-col items-center text-center', compact ? 'gap-1 px-2 py-3' : 'gap-1.5 px-6 py-9', className)}>
      <p className={cn('font-semibold text-text-strong', compact ? 'text-label' : 'text-title')}>{title}</p>
      {description && <p className={cn('text-text-muted', compact ? 'max-w-64 text-caption' : 'max-w-sm text-label')}>{description}</p>}
      {action && <div className={cn('flex flex-wrap justify-center gap-2', compact ? 'mt-2' : 'mt-3')}>{action}</div>}
    </div>
  );
}
