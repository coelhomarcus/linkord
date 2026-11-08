import type { CustomStatus } from '@/shared/types/protocol';
import { cn } from '@/shared/lib/utils';

/** A custom status on one line: the emoji, then the text, cut with an ellipsis (the full text in the
 * tooltip). Renders nothing for no status. */
export function CustomStatusText({ custom, className }: { custom: CustomStatus | null; className?: string }) {
  if (!custom) return null;
  const full = [custom.emoji, custom.text].filter(Boolean).join(' ');
  return (
    <span title={full} data-custom-status className={cn('flex min-w-0 items-center gap-1', className)}>
      {custom.emoji && <span aria-hidden={!!custom.text} className="flex-none leading-none">{custom.emoji}</span>}
      {custom.text && <span className="min-w-0 truncate">{custom.text}</span>}
    </span>
  );
}
