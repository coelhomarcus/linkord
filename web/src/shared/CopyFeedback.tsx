import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CopyIcon, type Icon } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

// The look every copy control shares, driven by `useCopyToClipboard`'s `copied`. The words a screen
// reader hears come from the announcement `copyToClipboard` makes, so both pieces are decorative to it.

/** The control's own icon, swapped for a green check while `copied` is on. The check pops in like a
 * popup appearing (150 ms) and the icon fades back like feedback (100 ms); reduced motion keeps only
 * the fades. */
export function CopyStatusIcon({ copied, size, icon: Idle = CopyIcon, className, checkClassName = 'text-green' }: {
  copied: boolean;
  size: number;
  /** what the control shows before and after the check mark */
  icon?: Icon;
  className?: string;
  /** the check's colour, for a control whose own background is green */
  checkClassName?: string;
}) {
  // the icon fades back only after a check, so a list of copy buttons does not flicker in on first paint
  const [returning, setReturning] = useState(false);
  if (copied && !returning) setReturning(true);
  return copied
    ? <CheckIcon key="copied" size={size} aria-hidden className={cn('flex-none animate-in fade-in-0 zoom-in-75 duration-150 ease-out-expo', checkClassName, className)} />
    : <Idle key="idle" size={size} aria-hidden className={cn('flex-none', returning && 'animate-in fade-in-0 duration-100 ease-out-expo', className)} />;
}

/** A copy control's text: "Copied" while `copied` is on, otherwise its own words (or nothing, for a
 * label that only appears to confirm). */
export function CopyLabel({ copied, children = null }: { copied: boolean; children?: ReactNode }) {
  const { t } = useTranslation('common');
  return copied ? t('clipboard.copied') : children;
}
