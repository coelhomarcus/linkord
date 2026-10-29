import { useLayoutEffect, useRef } from 'react';

import { CallDock } from '@/features/calls/CallDock';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';

// the gap between the dock and the edges it floats beside (the shell's own gap)
const EDGE = 8;

interface FloatingUserDockProps {
  onReturnToCall: () => void;
  onOpenProfile: (userId: string) => void;
  showReturnToCall: boolean;
}

/** The account card (profile, mute, call controls, settings) laid over the
 * bottom of the rail and the conversation list together, instead of belonging
 * to the list. With the list hidden or drawn as a drawer only the rail is on
 * screen, so the card narrows to a column of icons beside it. On a phone there
 * is no rail: the tab bar (MobileTabBar) takes its place and this draws
 * nothing. The space it takes is published as CSS variables for the rail and
 * the list to keep clear of it and, on the root, for whatever else floats in
 * that corner (the call's picture-in-picture). */
export function FloatingUserDock({ onReturnToCall, onOpenProfile, showReturnToCall }: FloatingUserDockProps) {
  const { isMobile, isOverlay, open } = useSidebar();
  const ref = useRef<HTMLDivElement | null>(null);
  const wide = !isOverlay && open;

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    // outside the shell's tree (the PiP is portaled to the body), so on the root
    const root = document.documentElement;
    const publish = () => {
      const clearance = `${Math.ceil(el.getBoundingClientRect().height) + EDGE * 2}px`;
      host.style.setProperty('--dock-clearance', clearance);
      root.style.setProperty('--user-dock-clearance', clearance);
      // the list only needs room under a dock that is as wide as the list
      host.style.setProperty('--dock-list-clearance', wide ? clearance : '0px');
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      host.style.removeProperty('--dock-clearance');
      root.style.removeProperty('--user-dock-clearance');
      host.style.removeProperty('--dock-list-clearance');
    };
  }, [wide, isMobile]);

  if (isMobile) return null;
  return (
    <div
      ref={ref}
      data-user-dock={wide ? 'wide' : 'compact'}
      className="absolute bottom-shell left-shell z-30 transition-[width] duration-300 ease-out motion-reduce:transition-none"
      // the rail (4rem) plus the list, less the gap kept on both outer sides
      style={{ width: wide ? 'calc(4rem + var(--sidebar-width) - 1rem)' : '3rem' }}
    >
      <CallDock
        layout={wide ? 'wide' : 'compact'}
        onReturnToCall={onReturnToCall}
        onOpenProfile={onOpenProfile}
        showReturnToCall={showReturnToCall}
      />
    </div>
  );
}
