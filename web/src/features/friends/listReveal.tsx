import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASE_OUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';

type SkeletonKind = 'friend' | 'incoming-request' | 'outgoing-request' | 'invitation';

function UserRowSkeleton({ kind }: { kind: Exclude<SkeletonKind, 'invitation'> }) {
  const actions = kind === 'friend'
    ? ['size-9 rounded-full', 'size-9 rounded-full']
    : kind === 'incoming-request'
      ? ['h-8 w-16 rounded-lg', 'h-8 w-16 rounded-lg']
      : ['h-8 w-20 rounded-lg'];

  return (
    <div className="-mx-2.5 flex h-[62px] items-center gap-3 px-2.5">
      <Skeleton shape="circle" className="size-8" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton shape="text" className="w-32" />
        <Skeleton shape="text" className="h-2.5 w-24" />
      </div>
      <div className="flex flex-none items-center gap-2.5">
        {actions.map((className, index) => <Skeleton key={index} className={className} />)}
      </div>
    </div>
  );
}

function InvitationRowSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md px-3 py-3">
      <Skeleton className="size-10 rounded-[30%]" />
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2">
        <Skeleton shape="text" className="h-4 w-36" />
        <div className="flex items-center gap-2">
          <Skeleton shape="text" className="w-24" />
          <Skeleton shape="text" className="w-16" />
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <Skeleton className="h-8 w-14 rounded-lg" />
        <Skeleton className="h-8 w-16 rounded-lg" />
      </div>
    </div>
  );
}

/** Loading rows follow the dimensions and actions of the list they replace. */
export function SocialRowsSkeleton({ label, rows = 4, kind = 'friend' }: { label: string; rows?: number; kind?: SkeletonKind }) {
  return (
    <FadeIn>
      <SkeletonGroup label={label} className="flex flex-col">
        {Array.from({ length: rows }, (_, index) => (
          kind === 'invitation'
            ? <InvitationRowSkeleton key={index} />
            : <UserRowSkeleton key={index} kind={kind} />
        ))}
      </SkeletonGroup>
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
  return <FadeIn skip={restored} className={cn('flex flex-col', className)}><AnimatePresence initial={false}>{children}</AnimatePresence></FadeIn>;
}

export function RevealRow({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
      // clips the row as its height collapses on the way out
      className="overflow-visible"
      style={{ clipPath: 'inset(0 -0.625rem round 0.5rem)' }}
    >
      {children}
    </motion.div>
  );
}
