import { cn } from '@/shared/lib/utils';

/** The fill under a navigation list's current item. It switches instantly:
 * the old item loses it and the new one gains it, with no slide or fade. The
 * item needs `relative isolate`, the fill sits beneath its content. */
export function ActiveFill({ className }: { className?: string }) {
  return <span aria-hidden className={cn('absolute inset-0 -z-10 rounded-md bg-nav-active', className)} />;
}
