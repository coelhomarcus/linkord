import { cn } from '@/shared/lib/utils';
import { colorFor } from '@/shared/Avatar';
import { conversationInitials } from '@/features/conversations/conversationUtils';

/** A server's picture, or its initials on its own colour, in Discord's
 * squircle — the same shape at rest, hovered or selected. */
export function ServerIcon({ id, name, icon, size = 48, className }: {
  id: string;
  name: string;
  icon: string;
  size?: number;
  /** kept for callers that still say which server is open; the shape no longer changes */
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid flex-none select-none place-items-center overflow-hidden rounded-[30%] font-semibold text-white',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ...(icon ? {} : { background: colorFor(id) }) }}
    >
      {icon ? <img src={icon} alt="" draggable={false} className="size-full object-cover" /> : conversationInitials(name)}
    </span>
  );
}
