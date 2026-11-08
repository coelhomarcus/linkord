import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { CustomStatus } from '@/shared/types/protocol';
import { timeOptions } from '@/shared/lib/timeFormat';
import { cn } from '@/shared/lib/utils';

const SHELL = 'border border-border-strong bg-bg-tertiary';

/** A custom status as a thought bubble beside a profile's big avatar, its trail of dots pointing
 * down at it. With `onEdit` it is the owner's own: a small bar over it edits or clears it, and with
 * no status an invitation to set one takes its place. Without `onEdit` there is nothing to show for
 * no status. Compact rows (DM list, members, the dock) keep the one-line CustomStatusText. */
export function CustomStatusBubble({ custom, onEdit, onClear, className }: {
  custom: CustomStatus | null;
  onEdit?: () => void;
  onClear?: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation('status');
  if (!custom && !onEdit) return null;

  const tail = (
    <>
      <span aria-hidden className={cn('absolute -bottom-1.5 left-1 size-2.5 rounded-full', SHELL)} />
      <span aria-hidden className={cn('absolute -bottom-3 -left-0.5 size-1.5 rounded-full', SHELL)} />
    </>
  );

  if (!custom) {
    return (
      <div data-custom-status-bubble className={cn('relative w-fit max-w-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95', className)}>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('menu.setCustom')}
          className={cn(
            SHELL,
            'touch-target relative flex max-w-full items-center gap-1.5 rounded-2xl px-3 py-1.5 text-left text-label text-text-muted transition-colors hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          )}
        >
          <PlusIcon size={14} weight="bold" className="flex-none" />
          <span className="line-clamp-2 min-w-0">{t('bubble.invite')}</span>
        </button>
        {tail}
      </div>
    );
  }

  const full = [custom.emoji, custom.text].filter(Boolean).join(' ');
  const until = custom.expiresAt
    ? t('custom.until', { time: new Date(custom.expiresAt).toLocaleTimeString(i18n.language, timeOptions(i18n.language)) })
    : null;

  return (
    <div data-custom-status-bubble className={cn('group/bubble relative w-fit max-w-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95', className)}>
      <div
        title={until ? `${full} (${until})` : full}
        data-custom-status
        className={cn(SHELL, 'flex min-w-0 items-start gap-1.5 rounded-2xl px-3 py-1.5 text-label text-text-primary')}
      >
        {custom.emoji && <span aria-hidden={!!custom.text} className={cn('flex-none leading-5', !custom.text && 'text-heading')}>{custom.emoji}</span>}
        {custom.text && <span className="line-clamp-2 min-w-0 leading-5 wrap-break-word">{custom.text}</span>}
        {until && <span className="sr-only">{until}</span>}
      </div>
      {tail}
      {onEdit && (
        // Above the bubble, so it never covers the text; shown on hover or when one of its buttons has
        // focus, and always on touch screens, which have no hover.
        <div
          role="group"
          aria-label={t('bubble.actions')}
          className={cn(
            // fingertip-sized on a touch screen, and spaced so the two 44px hit areas do not overlap
            'absolute -top-7 right-0 flex rounded-md p-0.5 shadow-popover transition-opacity pointer-coarse:-top-11 pointer-coarse:gap-2',
            'bg-popover border border-border-strong',
            'opacity-0 group-hover/bubble:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('menu.editCustom')}
            className="touch-target relative grid size-6 place-items-center rounded-sm pointer-coarse:size-9 text-text-secondary hover:bg-fill-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <PencilSimpleIcon size={14} />
          </button>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t('menu.clearCustom')}
              className="touch-target relative grid size-6 place-items-center rounded-sm pointer-coarse:size-9 text-text-secondary hover:bg-red/12 hover:text-red-text focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <TrashIcon size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
