import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';
import { EmptyIllustration } from './empty-illustrations';
import type { EmptyIllustrationName } from './empty-illustrations';

export type { EmptyIllustrationName };

/** The one face of "there is nothing here": an illustration, what is (not)
 * there, what to do about it, and that action when there is one. `compact` is
 * for narrow or nested spots (a sidebar, a section inside a list, a popover). */
export function EmptyState({ illustration, title, description, action, size = 'default', className }: {
  illustration: EmptyIllustrationName;
  title: string;
  description?: ReactNode;
  /** one or two buttons; a lone link-style action reads better as a Button too */
  action?: ReactNode;
  size?: 'default' | 'compact';
  className?: string;
}) {
  const compact = size === 'compact';
  return (
    <div data-slot="empty-state" className={cn('flex select-none flex-col items-center text-center', compact ? 'gap-1 px-4 py-6' : 'gap-1.5 px-6 py-10', className)}>
      <EmptyIllustration name={illustration} className={cn('flex-none', compact ? 'mb-2 h-[72px] w-24' : 'mb-3 h-[120px] w-40')} />
      <p className={cn('font-semibold text-text-strong', compact ? 'text-label' : 'text-title')}>{title}</p>
      {description && <p className={cn('text-text-muted', compact ? 'max-w-64 text-caption' : 'max-w-sm text-label')}>{description}</p>}
      {action && <div className={cn('flex flex-wrap justify-center gap-2', compact ? 'mt-2' : 'mt-3')}>{action}</div>}
    </div>
  );
}
