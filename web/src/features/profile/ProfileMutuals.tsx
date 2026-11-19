import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import type { ProfileDetails } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';

const SHOWN_AVATARS = 3;
const LINK = 'flex min-w-0 items-center gap-1.5 rounded-sm hover:text-text-primary hover:underline focus-ring';

/** "6 amigos mútuos • 2 servidores em comum" under a compact profile's name,
 * the friends led by a few of their avatars; each count opens what you have
 * in common. Nothing when there is nothing in common (or nothing read). */
export function ProfileMutuals({ details, onOpen, ringClassName, className }: {
  /** the caller reads it, so the whole card can wait for it */
  details: ProfileDetails | null;
  onOpen: () => void;
  /** the surface behind the avatars, so their overlap reads as a cutout */
  ringClassName: string;
  className?: string;
}) {
  const { t } = useTranslation('profile');
  const friends = details?.mutualFriends;
  const servers = details?.mutualServers;
  const hasFriends = !!friends && friends.total > 0;
  const hasServers = !!servers && servers.total > 0;
  if (!hasFriends && !hasServers) return null;

  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-text-secondary', className)}>
      {hasFriends && (
        <button type="button" onClick={onOpen} className={LINK}>
          {friends.items.length > 0 && (
            <span aria-hidden className="flex flex-none items-center -space-x-1.5">
              {friends.items.slice(0, SHOWN_AVATARS).map((friend) => (
                <Avatar key={friend.id} id={friend.id} name={friend.displayName} avatar={friend.avatar} avatarColor={friend.avatarColor} size={20} className={cn('ring-2', ringClassName)} />
              ))}
            </span>
          )}
          <span className="truncate">{t('mutuals.friends', { count: friends.total })}</span>
        </button>
      )}
      {hasFriends && hasServers && <span aria-hidden>•</span>}
      {hasServers && (
        <button type="button" onClick={onOpen} className={LINK}>
          <span className="truncate">{t('mutuals.servers', { count: servers.total })}</span>
        </button>
      )}
    </p>
  );
}
