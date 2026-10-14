import { motion, useReducedMotion } from 'motion/react';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';

/** The light-gray wash under a nav's current item, rendered by that item alone.
 * Every item of one nav passes the same `layoutId`, so the wash slides from the
 * old item to the new one: cross-fading two washes dims both halfway, which
 * reads as a blink. The item needs `relative isolate`, the wash sits beneath its
 * content. */
export function ActiveWash({ layoutId, className }: { layoutId: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      className={cn('absolute inset-0 -z-10 rounded-md bg-fill-active', className)}
    />
  );
}
