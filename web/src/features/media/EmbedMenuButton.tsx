import { DotsThreeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { MouseEvent } from 'react';
import { cn } from '@/shared/lib/utils';

/** The card's menu for a keyboard or a screen reader, which pass no right-click
 * or long press: it sends the same `contextmenu` event a long press does
 * (GlobalContextMenu), from inside the card, so the one menu written for
 * right-click opens with the card as its target (removing it, for its author).
 * Shown on hover and focus; on a touch-first device only when focused, since a
 * finger already has the long press. */
export function EmbedMenuButton({ className }: { className?: string }) {
  const { t } = useTranslation('media');
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    // after this click is done: a click from Enter or Space is still on its way
    // through the document, and the menu would take it for a press outside it
    window.setTimeout(() => {
      button.dispatchEvent(new window.MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true, clientX: rect.left, clientY: rect.bottom, button: 2, buttons: 0,
      }));
      // a menu opened as a right-click leaves focus where the pointer was; from
      // a keyboard it has to land in the menu, or its items can't be reached
      window.requestAnimationFrame(() => {
        const open = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].find((menu) => menu.getClientRects().length > 0);
        open?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      });
    });
  };
  return (
    <button
      type="button"
      aria-label={t('embed.moreActions')}
      aria-haspopup="menu"
      onClick={open}
      className={cn(
        'absolute top-1.5 right-1.5 z-10 grid size-7 place-items-center rounded-md bg-bg-floating/90 text-text-secondary opacity-0 outline-none',
        'transition-opacity duration-100 motion-reduce:transition-none hover:text-text-primary focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50',
        'pointer-fine:group-hover/embed:opacity-100',
        className,
      )}
    >
      <DotsThreeIcon size={18} weight="bold" />
    </button>
  );
}
