import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASE_OUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';

type SkeletonKind = 'friend' | 'incoming-request' | 'outgoing-request' | 'invitation';

function Placeholder({ className }: { className: string }) {
  return <div aria-hidden className={cn('rounded-sm bg-fill-subtle', className)} />;
}

function UserRowSkeleton({ kind }: { kind: Exclude<SkeletonKind, 'invitation'> }) {
  const actions = kind === 'friend'
    ? ['size-9 rounded-full', 'size-9 rounded-full']
    : kind === 'incoming-request'
      ? ['h-8 w-16 rounded-lg', 'h-8 w-16 rounded-lg']
      : ['h-8 w-20 rounded-lg'];

  return (
    <div aria-hidden className="-mx-2.5 flex h-[62px] animate-pulse items-center gap-3 px-2.5">
      <div className="size-8 flex-none rounded-full bg-fill-subtle" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Placeholder className="h-3 w-32" />
        <Placeholder className="h-2.5 w-24" />
      </div>
      <div className="flex flex-none items-center gap-2.5">
        {actions.map((className, index) => <Placeholder key={index} className={className} />)}
      </div>
    </div>
  );
}

function InvitationRowSkeleton() {
  return (
    <div aria-hidden className="flex animate-pulse flex-wrap items-center gap-3 rounded-md px-3 py-3">
      <div className="size-10 flex-none rounded-[30%] bg-fill-subtle" />
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2">
        <Placeholder className="h-4 w-36 max-w-full" />
        <div className="flex items-center gap-2">
          <Placeholder className="h-3 w-24" />
          <Placeholder className="h-3 w-16" />
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <Placeholder className="h-8 w-14 rounded-lg" />
        <Placeholder className="h-8 w-16 rounded-lg" />
      </div>
    </div>
  );
}

/** Loading rows follow the dimensions and actions of the list they replace. */
export function SocialRowsSkeleton({ label, rows = 4, kind = 'friend' }: { label: string; rows?: number; kind?: SkeletonKind }) {
  return (
    <FadeIn>
      <div role="status" aria-label={label} className="flex flex-col">
        {Array.from({ length: rows }, (_, index) => (
          kind === 'invitation'
            ? <InvitationRowSkeleton key={index} />
            : <UserRowSkeleton key={index} kind={kind} />
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
