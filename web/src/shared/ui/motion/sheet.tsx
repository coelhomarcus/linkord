import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { EASE_DRAWER, EASE_OUT } from '@/shared/lib/ease';
import { cn } from '@/shared/lib/utils';
import { useTranslation } from 'react-i18next';

const SLIDE = { duration: 0.36, ease: EASE_DRAWER } as const;
const FADE = { duration: 0.16, ease: EASE_OUT } as const;
// `--shadow-popover` blurs 60px (styles/index.css). A -100% slide parks the
// box's right edge on the screen edge; this much empty width after the panel
// parks the shadow past that edge too, so nothing is left when visibility
// turns hidden.
const SLIDE_BLEED = '64px';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  "[tabindex]:not([tabindex='-1'])",
].join(',');

/** Locks the page behind the sheet, moves focus into it, and on close puts
 * both back the way they were. */
function useModalFocus(open: boolean, panelRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, overflow: body.style.overflow };
    // position: fixed, not just overflow: hidden — iOS still scrolls the page under an overflow lock
    Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', right: '0', overflow: 'hidden' });
    // whatever opened the sheet (a header button, the rail toggle) gets focus back
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // The panel only becomes focusable once it is visible, a frame or two after
    // opening, and focus() on it before then is silently ignored: retry until it
    // lands. The panel itself, not its first control: that may be a tooltip
    // trigger whose tooltip would open on focus and swallow the first Escape.
    let frame = 0;
    let attempts = 0;
    const focusInto = () => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.focus({ preventScroll: true });
      if (document.activeElement !== panel && attempts++ < 15) frame = requestAnimationFrame(focusInto);
    };
    frame = requestAnimationFrame(focusInto);

    return () => {
      cancelAnimationFrame(frame);
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}

function trapTab(event: KeyboardEvent<HTMLDivElement>, panel: HTMLDivElement | null) {
  const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
  if (focusable.length === 0) {
    event.preventDefault();
    panel?.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** A modal panel sliding in from one edge, for narrow screens: the conversation
 * list from the left, group details / media from the right, the emoji picker
 * from the bottom.
 *
 * It stays mounted while closed — like the desktop column, its content (a
 * search typed, a scroll position) is still there when it opens again — and
 * hides itself once the slide out ends: `visibility` rides the same animation,
 * so nothing has to keep a duration in sync. While closed it is inert.
 *
 * A left sheet inset from the screen edge (`leadingInset`, the server rail on
 * a tablet) slides as a wider box. The inset sits inside that box, ahead of
 * the panel: the close move is -100% of the box, and translating the inset
 * panel alone would leave the inset painted until visibility hides it. */
export function Sheet({ open, onOpenChange, side, ariaLabel, dismissLabel, className, backdropClassName, style, leadingInset, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'left' | 'right' | 'bottom';
  ariaLabel: string;
  /** the backdrop's label: it is a button that closes the sheet */
  dismissLabel?: string;
  className?: string;
  backdropClassName?: string;
  /** CSS variables the panel's classes read: it is portaled, so it inherits none */
  style?: CSSProperties;
  /** CSS length the open panel sits in from the screen edge it slides from */
  leadingInset?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, panelRef);

  const visibility = open ? 'visible' : 'hidden';
  const offscreen = side === 'left' ? '-100%' : '100%';
  const slide = side === 'bottom' ? { y: open ? '0%' : offscreen } : { x: open ? '0%' : offscreen };
  // Only a left sheet is inset from the edge it enters from. The rail stays
  // put; the drawer has to finish its slide clear of it.
  const inset = side === 'left' ? leadingInset : undefined;

  // Two fixed layers in a box-less wrapper: the backdrop spans the viewport and
  // paints the scrim, the panel is inset off one side and paints its own surface.
  return createPortal(
    <div style={style} className="pointer-events-none fixed left-0 top-0 z-50 size-0">
      <motion.button
        type="button"
        aria-label={dismissLabel ?? t('page.close')}
        tabIndex={open ? 0 : -1}
        initial={false}
        animate={{ opacity: open ? 1 : 0, visibility }}
        transition={reduce ? FADE : SLIDE}
        onClick={() => onOpenChange(false)}
        className={cn('fixed inset-0 cursor-default bg-black/40', open ? 'pointer-events-auto' : 'pointer-events-none', backdropClassName)}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        inert={!open}
        tabIndex={-1}
        initial={false}
        animate={reduce ? { opacity: open ? 1 : 0, visibility } : { ...slide, visibility }}
        transition={reduce ? FADE : SLIDE}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onOpenChange(false);
          } else if (event.key === 'Tab') {
            trapTab(event, panelRef.current);
          }
        }}
        className={inset
          ? 'pointer-events-none fixed inset-y-0 left-0 flex h-dvh w-fit flex-row outline-none will-change-transform'
          : cn(
            'fixed flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] shadow-popover outline-none will-change-transform',
            side === 'bottom' ? 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t border-border' : 'inset-y-0 h-dvh pt-[env(safe-area-inset-top)]',
            side === 'left' && 'left-0 border-r border-border',
            side === 'right' && 'right-0 w-80 max-w-[85vw] border-l border-border bg-surface-panel [--surface-base:var(--color-surface-panel)]',
            open ? 'pointer-events-auto' : 'pointer-events-none',
            className,
          )}
      >
        {inset ? (
          <>
            <div data-sheet-inset aria-hidden className="h-full shrink-0" style={{ width: inset }} />
            <div className={cn(
              'flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-popover',
              open ? 'pointer-events-auto' : 'pointer-events-none',
              className,
            )}>
              {children}
            </div>
            <div data-sheet-bleed aria-hidden className="h-full shrink-0" style={{ width: SLIDE_BLEED }} />
          </>
        ) : children}
      </motion.div>
    </div>,
    document.body,
  );
}
