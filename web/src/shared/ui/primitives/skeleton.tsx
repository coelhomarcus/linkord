import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

const SHAPES = {
  block: 'rounded-md',
  // a line of text: give it the height of the text it stands for and a width
  text: 'h-3 rounded-sm',
  circle: 'rounded-full',
} as const;

/** A grey shape standing in for content that is still loading. Size it like
 * the content it replaces, so nothing moves when that content arrives. */
export function Skeleton({ shape = 'block', className }: { shape?: keyof typeof SHAPES; className?: string }) {
  return <div aria-hidden data-slot="skeleton" className={cn('max-w-full flex-none bg-fill-hover motion-safe:animate-skeleton', SHAPES[shape], className)} />;
}

/** The container of a loading skeleton. Screen readers hear `label` (the shapes
 * themselves are hidden from them); everyone else sees the shapes. */
export function SkeletonGroup({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">{label}</span>
      {children}
    </div>
  );
}
