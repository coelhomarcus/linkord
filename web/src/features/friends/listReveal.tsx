import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASE_OUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';

/** Rows shaped like SocialUserRow, so the list doesn't change shape when they're replaced. */
export function SocialRowsSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <FadeIn>
      <div role="status" aria-label={label} className="flex flex-col divide-y divide-border-subtle">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} aria-hidden className="flex animate-pulse items-center gap-3 px-3 py-3">
            <div className="size-10 flex-none rounded-full bg-fill-subtle" />
            <div className="flex flex-col gap-2">
              <div className="h-3 w-32 rounded-sm bg-fill-subtle" />
              <div className="h-2.5 w-20 rounded-sm bg-fill-subtle" />
            </div>
          </div>
        ))}
      </div>
    </FadeIn>
  );
}

export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** The rows of a list. They enter with a short stagger and collapse when they
 * leave (an accepted request, a removed friend), so the rows below glide up. */
export function RevealList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col divide-y divide-border-subtle', className)}>
      <AnimatePresence initial>{children}</AnimatePresence>
    </div>
  );
}

// past the first screenful a longer stagger is only a wait
const MAX_STAGGERED = 8;

export function RevealRow({ index, children }: { index: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT, delay: Math.min(index, MAX_STAGGERED) * 0.03 } }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
      // clips the row as its height collapses on the way out
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}
