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

/** `skip`: content restored from memory is already in place, so it doesn't fade in again. */
export function FadeIn({ children, className, skip = false }: { children: ReactNode; className?: string; skip?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce || skip ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** The rows of a list. The first rows arrive with the list (its FadeIn), all at
 * once: staggering them read as the page still settling into place. Only a row
 * that turns up later fades in on its own, and a row that leaves (an accepted
 * request, a removed friend) collapses so the rows below glide up. */
export function RevealList({ children, restored = false, className }: { children: ReactNode; restored?: boolean; className?: string }) {
  return (
    <FadeIn skip={restored} className={cn('flex flex-col divide-y divide-border-subtle', className)}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </FadeIn>
  );
}

export function RevealRow({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
      // clips the row as its height collapses on the way out
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}
