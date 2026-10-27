import { useLayoutEffect, useRef } from 'react';

import { CallDock } from '@/features/calls/CallDock';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { cn } from '@/shared/lib/utils';

// the gap between the dock and the edges it floats beside (the shell's own gap)
const EDGE = 8;

interface FloatingUserDockProps {
  /** shell: floats over the rail and the list from 768px; drawer: inside the
   * phone drawer, where the rail and the list share one sheet */
  placement: 'shell' | 'drawer';
  onReturnToCall: () => void;
  onOpenProfile: (userId: string) => void;
  showReturnToCall: boolean;
  onNavigate?: () => void;
}

/** The account card (profile, mute, call controls, settings) laid over the
 * bottom of the rail and the conversation list together, instead of belonging
 * to the list. With the list hidden or drawn as a drawer only the rail is on
 * screen, so the card narrows to a column of icons beside it. The space it
 * takes is published as CSS variables for the rail and the list to keep clear
 * of it. */
export function FloatingUserDock({ placement, onReturnToCall, onOpenProfile, showReturnToCall, onNavigate }: FloatingUserDockProps) {
  const { isMobile, isOverlay, open } = useSidebar();
  const ref = useRef<HTMLDivElement | null>(null);
  const wide = placement === 'drawer' || (!isOverlay && open);
  const hidden = placement === 'shell' && isMobile;

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const publish = () => {
      const clearance = `${Math.ceil(el.getBoundingClientRect().height) + EDGE * 2}px`;
      host.style.setProperty('--dock-clearance', clearance);
      // the list only needs room under a dock that is as wide as the list
      host.style.setProperty('--dock-list-clearance', wide ? clearance : '0px');
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      host.style.removeProperty('--dock-clearance');
      host.style.removeProperty('--dock-list-clearance');
    };
  }, [wide, hidden]);

  if (hidden) return null;
  return (
    <div
      ref={ref}
      data-user-dock={wide ? 'wide' : 'compact'}
      className={cn(
        'absolute bottom-shell left-shell z-30 transition-[width] duration-300 ease-out motion-reduce:transition-none',
        placement === 'drawer' && 'right-shell',
      )}
      // the rail (4rem) plus the list, less the gap kept on both outer sides
      style={placement === 'shell' ? { width: wide ? 'calc(4rem + var(--sidebar-width) - 1rem)' : '3rem' } : undefined}
    >
      <CallDock
        layout={wide ? 'wide' : 'compact'}
        onReturnToCall={onReturnToCall}
        onOpenProfile={onOpenProfile}
        showReturnToCall={showReturnToCall}
        onNavigate={onNavigate}
      />
    </div>
  );
}
