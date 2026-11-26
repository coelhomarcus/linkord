import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

export const ROW_MENU = '[data-row-menu]';
const ROW_MENU_CONTROL = '[data-row-menu-control]';
export const NATIVE_PRESS = 'a, button, input, textarea, select, [contenteditable], [role="slider"], [data-download-url]';

export function isRowMenuTarget(element: Element, row: Element): boolean {
  const control = element.closest(NATIVE_PRESS);
  return !control || !row.contains(control) || control.matches(ROW_MENU_CONTROL);
}

export function useRowMenu() {
  const [anchor, setAnchor] = useState<{ getBoundingClientRect: () => DOMRect } | HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const primaryProps = { 'data-row-menu-control': '', 'aria-keyshortcuts': 'Shift+F10' };
  function show(nextAnchor: typeof anchor, nextOpener: HTMLElement | null) {
    if (!nextAnchor) return;
    opener.current = nextOpener;
    setAnchor(nextAnchor);
    setOpen(true);
  }

  const rowProps = {
    'data-row-menu': '',
    onContextMenu(event: MouseEvent<HTMLElement>) {
      if (event.shiftKey || !(event.target instanceof Element) || !isRowMenuTarget(event.target, event.currentTarget)) return;
      event.preventDefault();
      event.stopPropagation();
      const primary = event.currentTarget.querySelector<HTMLElement>(ROW_MENU_CONTROL);
      const { clientX: x, clientY: y } = event;
      show(x || y ? { getBoundingClientRect: () => DOMRect.fromRect({ x, y }) } : primary, primary);
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      if (!(event.target instanceof HTMLElement) || !event.target.matches(ROW_MENU_CONTROL)) return;
      event.preventDefault();
      event.stopPropagation();
      show(event.target, event.target);
    },
  };

  return {
    anchor, open, opener, primaryProps, rowProps,
    setOpen, clearAnchor: () => setAnchor(null),
    openFromButton(event: MouseEvent<HTMLButtonElement>) {
      show(event.currentTarget, event.currentTarget);
    },
  };
}
