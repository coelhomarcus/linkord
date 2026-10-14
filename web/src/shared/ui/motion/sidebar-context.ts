import { createContext, useContext } from 'react';
import type { CSSProperties } from 'react';

export interface SidebarContextValue {
  /** phone layout (< 768px) */
  isMobile: boolean;
  /** the conversation list is a drawer (< 1024px), opened with `openMobile` */
  isOverlay: boolean;
  /** the list as a column: shown or hidden (the saved preference) */
  open: boolean;
  /** the list as a drawer: open or closed */
  openMobile: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  /** whichever of the two applies at this width */
  toggleSidebar: () => void;
  /** the drawer is portaled to <body>, so it can't inherit these from the wrapper */
  sheetVars: CSSProperties;
}

export const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used inside SidebarProvider.');
  return context;
}
