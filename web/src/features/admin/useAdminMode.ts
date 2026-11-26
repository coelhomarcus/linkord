import { createRef } from 'react';
import type { RefObject } from 'react';
import { useOutletContext } from 'react-router';
import type { AdminMode } from './useAdminLayout';

export interface AdminOutletContext {
  mode: AdminMode;
  /** false until the area has been measured once: `mode` is only a guess before that */
  measured: boolean;
  /** Width inside the main gutters, where each table and its filters actually render. */
  contentWidth: number;
  standalone: boolean;
  /** the scrolling column of the area, for pages that restore a position */
  scroller: RefObject<HTMLElement | null>;
}

/** Lets a routed page know which navigation surface is showing (the bare
 * /admin entry is the index in compact and a redirect in wide). */
export function useAdminMode(): AdminMode {
  // a page rendered outside the layout (a test, a future standalone use) is wide
  return useOutletContext<AdminOutletContext | undefined>()?.mode ?? 'wide';
}

const NO_SCROLLER = createRef<HTMLElement>();

export function useAdminScroller(): RefObject<HTMLElement | null> {
  return useOutletContext<AdminOutletContext | undefined>()?.scroller ?? NO_SCROLLER;
}

/** Whether `mode` is a measurement yet. A page that REDIRECTS on the mode (the
 * bare /admin entry) must wait for it, or it acts on the guess. */
export function useAdminMeasured(): boolean {
  return useOutletContext<AdminOutletContext | undefined>()?.measured ?? true;
}

/** Each list declares the width its columns need, independently of the sidebar. */
export function useAdminTableFits(minWidth = 760): boolean {
  const width = useOutletContext<AdminOutletContext | undefined>()?.contentWidth ?? 0;
  return width === 0 || width >= minWidth;
}

export function useStandaloneAdmin(): boolean {
  return useOutletContext<AdminOutletContext | undefined>()?.standalone ?? false;
}
