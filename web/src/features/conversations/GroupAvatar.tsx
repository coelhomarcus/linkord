import { cn } from '@/shared/lib/utils';
import { colorFor } from '@/shared/Avatar';
import { conversationInitials } from './conversationUtils';

interface GroupAvatarProps {
  /** the group's id: with no picture, its color (the same way an account's is) */
  id: string;
  title: string;
  avatar?: string | null;
  active?: boolean;
  size?: number;
  className?: string;
}

export function GroupAvatar({ id, title, avatar, active, size = 44, className }: GroupAvatarProps) {
  const solid = !avatar;
  return (
    <div
      className={cn(
        'grid flex-none place-items-center overflow-hidden rounded-full font-semibold transition-colors duration-300',
        // no picture: a solid color with white initials, like an account. With
        // one, a quiet ring (neutral even when selected) frames it
        solid ? 'text-white' : cn('border border-border', active ? 'bg-primary/20 text-text-primary' : 'bg-fill-hover text-text-secondary'),
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ...(solid ? { background: colorFor(id) } : {}) }}
    >
      {avatar ? <img src={avatar} alt="" className="size-full object-cover" /> : conversationInitials(title)}
    </div>
  );
}
