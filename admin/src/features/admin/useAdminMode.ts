import { createRef, type RefObject } from 'react';
import { useOutletContext } from 'react-router';

export interface AdminOutletContext {
  contentWidth: number;
  scroller: RefObject<HTMLElement | null>;
}

const NO_SCROLLER = createRef<HTMLElement>();

export function useAdminScroller(): RefObject<HTMLElement | null> {
  return useOutletContext<AdminOutletContext | undefined>()?.scroller ?? NO_SCROLLER;
}

/** Each list declares the width its columns need, independently of the sidebar. */
export function useAdminTableFits(minWidth = 760): boolean {
  const width = useOutletContext<AdminOutletContext | undefined>()?.contentWidth ?? 0;
  return width === 0 || width >= minWidth;
}
