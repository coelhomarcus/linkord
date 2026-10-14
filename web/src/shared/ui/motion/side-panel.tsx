import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SPRING_SIDEBAR } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';

/** A panel docked on the right of the content (group details, media, the call
 * chat), moving like the conversation list on the left: the column's width
 * springs open or shut and the panel, pinned to the edge facing the content,
 * rides out with it as one sheet. Closed, it is zero wide and inert. */
export function SidePanel({ open, width, ariaLabel, className, children }: {
  open: boolean;
  width: number;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.aside
      aria-label={ariaLabel}
      initial={false}
      animate={{ width: open ? width : 0 }}
      transition={reduce ? { duration: 0 } : SPRING_SIDEBAR}
      className={cn('relative flex-none overflow-hidden will-change-[width]', className)}
    >
      <div inert={!open} className="absolute inset-y-0 left-0 flex flex-col" style={{ width }}>
        {children}
      </div>
    </motion.aside>
  );
}
