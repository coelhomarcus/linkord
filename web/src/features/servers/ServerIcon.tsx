import { cn } from '@/shared/lib/utils';
import { colorFor } from '@/shared/Avatar';
import { conversationInitials } from '@/features/conversations/conversationUtils';

/** A server's picture, or its initials on its own colour. Discord's shape:
 * a circle at rest, a rounded square while hovered or selected. */
export function ServerIcon({ id, name, icon, size = 48, active = false, className }: {
  id: string;
  name: string;
  icon: string;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid flex-none select-none place-items-center overflow-hidden font-semibold text-white transition-[border-radius] duration-150',
        active ? 'rounded-[30%]' : 'rounded-[50%] group-hover/server:rounded-[30%]',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ...(icon ? {} : { background: colorFor(id) }) }}
    >
      {icon ? <img src={icon} alt="" className="size-full object-cover" /> : conversationInitials(name)}
    </span>
  );
}
