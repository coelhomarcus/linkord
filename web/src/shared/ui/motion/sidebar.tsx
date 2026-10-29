import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { SidePanel } from './side-panel';
import { Sheet } from './sheet';
import { SidebarContext, useSidebar } from './sidebar-context';
import type { SidebarContextValue } from './sidebar-context';

// The same cut-offs the CSS uses (`md` = 768, `lg` = 1024): below 768 the app is
// on its phone layout; below 1024 the conversation list is a drawer, not a column.
const MOBILE_QUERY = '(max-width: 767px)';
const OVERLAY_QUERY = '(max-width: 1023px)';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

type SidebarStyle = CSSProperties & {
  /** the list as a column */
  '--sidebar-width'?: string;
  /** the list as a drawer */
  '--sidebar-width-mobile'?: string;
  /** from 768px the drawer opens beside the rail, which stays on screen */
  '--sidebar-overlay-offset'?: string;
};

/** Owns the conversation list's two states: shown/hidden as a column (a saved
 * preference) and open/closed as a drawer (only while the screen is narrow).
 * Either can be controlled or left to this component. ⌘/Ctrl+B toggles
 * whichever applies. */
export function SidebarProvider({ open, defaultOpen = true, onOpenChange, openMobile, onOpenMobileChange, className, style, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'style'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openMobile?: boolean;
  onOpenMobileChange?: (open: boolean) => void;
  style?: SidebarStyle;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const [ownOpenMobile, setOwnOpenMobile] = useState(false);
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isOverlay = useMediaQuery(OVERLAY_QUERY);
  const columnOpen = open ?? ownOpen;
  const drawerOpen = openMobile ?? ownOpenMobile;

  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange, open]);

  const setOpenMobile = useCallback((next: boolean) => {
    if (openMobile === undefined) setOwnOpenMobile(next);
    onOpenMobileChange?.(next);
  }, [onOpenMobileChange, openMobile]);

  const toggleSidebar = useCallback(() => {
    if (isOverlay) setOpenMobile(!drawerOpen);
    else setOpen(!columnOpen);
  }, [columnOpen, drawerOpen, isOverlay, setOpen, setOpenMobile]);

  // widening past the drawer range must not leave it "open", to pop back up
  // the next time the window narrows
  useEffect(() => {
    const list = window.matchMedia(OVERLAY_QUERY);
    const onChange = () => { if (!list.matches) setOpenMobile(false); };
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [setOpenMobile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  const mobileWidth = style?.['--sidebar-width-mobile'] ?? '18rem';
  const overlayOffset = style?.['--sidebar-overlay-offset'] ?? '0px';
  const value = useMemo<SidebarContextValue>(() => ({
    isMobile, isOverlay, open: columnOpen, openMobile: drawerOpen, setOpen, setOpenMobile, toggleSidebar,
    sheetVars: { '--sidebar-width-mobile': mobileWidth, '--sidebar-overlay-offset': overlayOffset } as CSSProperties,
  }), [columnOpen, drawerOpen, isMobile, isOverlay, mobileWidth, overlayOffset, setOpen, setOpenMobile, toggleSidebar]);

  return (
    <SidebarContext.Provider value={value}>
      <div {...props} style={{ '--sidebar-width': '16rem', ...style } as CSSProperties} className={cn('flex min-h-0 w-full min-w-0', className)}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** The conversation list: a column beside the content from 1024px, a drawer
 * from the left below that. */
export function Sidebar({ ariaLabel, className, panelClassName, children }: {
  ariaLabel: string;
  /** both forms: the column's frame and the drawer's panel */
  className?: string;
  /** the column's panel only (the drawer paints its own surface) */
  panelClassName?: string;
  children: ReactNode;
}) {
  const { isOverlay, open, openMobile, setOpenMobile, sheetVars } = useSidebar();
  if (isOverlay) {
    return (
      <Sheet
        side="left"
        open={openMobile}
        onOpenChange={setOpenMobile}
        ariaLabel={ariaLabel}
        dismissLabel="Fechar navegação"
        style={sheetVars}
        backdropClassName="md:left-(--sidebar-overlay-offset,0px)"
        // on a phone the list is the home screen, not a drawer over the chat: it takes the whole width
        className={cn('w-(--sidebar-width-mobile) max-w-[88vw] bg-background md:left-(--sidebar-overlay-offset,0px) max-md:w-full max-md:max-w-none max-md:border-r-0 max-md:shadow-none', className)}
      >
        {children}
      </Sheet>
    );
  }
  return (
    <SidePanel side="left" open={open} width="var(--sidebar-width)" ariaLabel={ariaLabel} className={className} panelClassName={cn('bg-background', panelClassName)}>
      {children}
    </SidePanel>
  );
}

/** The content beside the list. */
export function SidebarInset({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <main {...props} className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col bg-background', className)} />;
}
