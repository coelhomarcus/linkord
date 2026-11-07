import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';

/** Discord's round close button of a full-screen settings page, with "ESC"
 * under it; it stays in view while the page scrolls beside it. */
export function EscCloseButton({ onClose, className }: { onClose: () => void; className?: string }) {
  const { t } = useTranslation('common');
  return (
    <div className={cn('sticky top-0 flex w-[72px] flex-none flex-col items-center pt-[60px]', className)}>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('page.close')}
        className="grid size-9 place-items-center rounded-full border-2 border-text-secondary text-text-secondary transition-colors hover:bg-fill-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon size={18} weight="bold" />
      </button>
      <span aria-hidden className="mt-2 text-caption font-semibold text-text-secondary">ESC</span>
    </div>
  );
}
