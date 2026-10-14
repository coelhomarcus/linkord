import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SPRING_SIDEBAR } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';

/** A column docked beside the content — the conversation list on the left;
 * group details, media and the call chat on the right. Its width springs open
 * or shut and the panel, pinned to the edge facing the content, rides out with
 * it as one sheet: one spring drives both the slide and the content's reflow,
 * so the two can never drift apart. Closed, it is zero wide and inert. */
export function SidePanel({ open, width, side = 'right', ariaLabel, className, panelClassName, children }: {
  open: boolean;
  /** px, or any CSS length (`var(--sidebar-width)`) */
  width: number | string;
  side?: 'left' | 'right';
  ariaLabel: string;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.aside
      aria-label={ariaLabel}
      initial={false}
      animate={{ width: open ? width : 0 }}
      transition={reduce ? { duration: 0 } : SPRING_SIDEBAR}
      // clipped, so the panel never slides across whatever sits beside it
      className={cn('relative flex-none overflow-hidden will-change-[width]', className)}
    >
      <div
        inert={!open}
        className={cn('absolute inset-y-0 flex flex-col overflow-hidden', side === 'left' ? 'right-0' : 'left-0', panelClassName)}
        style={{ width }}
      >
        {children}
      </div>
    </motion.aside>
  );
}
